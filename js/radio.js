import { getDataPath } from "./constants.js"
import { SeededPRNG, IndexDrawPoolManager } from "./utility.js"

// Segment categories
const CAT_ADVERTS = 0
const CAT_IDENTS = 1
const CAT_MUSIC = 2
const CAT_NEWS = 3
const CAT_DJSOLO = 5

const DEFAULT_DJ_SPEECH_OFFSET_MS = 4000

/** @typedef {import("./types").StationMetadata} StationMetadata */
/** @typedef {import("./types").SegmentInfo} SegmentInfo */
/** @typedef {import("./types").SyncedSegment} SyncedSegment */
/** @typedef {import("./types").StationType} StationType */
/** @typedef {import("./types").IconType} IconType */

/** Metadata for a radio station */
export class StationMeta {
    /** @private @type {?Promise<StationMetadata>} */
    _metaPromise = null

    /**
     * @param {string} path - Path to station
     * @param {StationMetadata} meta - Metadata object (optional)
     */
    constructor(path, meta = null) {
        /** @type {string} - Path to station */
        this.path = path
        /** @type {StationMetadata} - Metadata object or null if not yet loaded */
        this.meta = meta
    }

    /**
     * Creates a radio station corresponding to the type defined in metadata
     * @returns {Promise<RadioStation>}
     */
    async createStation() {
        if (!this.meta) { await this.loadMeta() }

        switch (this.meta.type) {
            case "static":
                return new StaticStation(this.path, this.meta)
            case "talkshow":
                return new TalkshowStation(this.path, this.meta)
            default:
                return new DynamicStation(this.path, this.meta)
        }
    }

    /** Loads the metadata for this station */
    async loadMeta() {
        if (!this._metaPromise) {
            this._metaPromise = fetch(this.getAbsolutePath("station.json"))
                .then(res => res.json())
                .then(res => this.meta = res)
                .catch((err) => {
                    console.error(`Failed to load "${this.path}" metadata:`, err)
                })
        }
        return this._metaPromise;
    }

    /** Gets the absolute path for a path relative to station */
    getAbsolutePath(relativePath) {
        return getDataPath() + this.path + "/" + relativePath
    }

    /**
     * Returns a cloned object with a resolved path using `getAbsolutePath`
     * @template {{path: string}} T
     * @param {T} object 
     * @returns {T}
     */
    resolveObjectPath(object) {
        const info = Object.assign({}, object)
        info.path = this.getAbsolutePath(object.path)
        return info
    }

    /**
     * Returns the absolute path for an icon type if it exists
     * @param {IconType} type
     * @returns {string?}
     */
    getIcon(type) {
        if (!this.meta) { return null }

        const icon = this.meta.info.icon[type]
        if (icon) { return this.getAbsolutePath(icon) }
        return null
    }

    /**
     * Tries to get preffered icon type, defaults to closest alternative otherwise
     * @param {IconType} type
     * @returns {string?}
     */
    getPrefferedIcon(type) {
        /** @type {IconType[]} */
        const priority = ["color", "monochrome", "full"]

        let icon = this.getIcon(type)
        let index = 0
        while (!icon) {
            const newIconType = priority[index]
            index++
            
            if (newIconType != type) { return this.getIcon(newIconType) }
            if (index >= priority.length) { return null }
        }
        return icon
    }
}

/**
 * Class that describes what a radio station must implement
 * @abstract
 * @extends {StationMeta} 
 */
export class RadioStation extends StationMeta {
    /** @type {StationType} */
    type
    /** @type {number} */
    peekDepth = 0
    /** @type {number} - The amount of time that has passed since the first track of the radio station played (required for getting a synced segment) */
    accumulatedTime
    /** @type {number} - Current segment index */
    segmentIndex
    /** @type {number} - Current track index */
    trackIndex
    /** @private @type {number} */
    _historyLimit = 2
    /** @type {SegmentInfo[]} */
    segmentHistory

    /**
     * UTC time (in milliseconds) when the radio station playback sync was reset (resets every month)
     * @type {number}
     */
    get startTimestamp() { return Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) }

    get historyLimit() { return this._historyLimit }

    set historyLimit(value) {
        this._historyLimit = value
        this.segmentHistory = this.segmentHistory.slice(0, this._historyLimit)
    }

    constructor(path, meta) {
        super(path, meta)
        if (this.constructor === RadioStation) { throw new Error("Abstract class 'RadioStation' cannot be instantiated directly.") }

        this.resetState()
    }

    resetState() {
        this.accumulatedTime = 0
        this.segmentIndex = 0
        this.trackIndex = 0
        this.segmentHistory = []
        this.PRNG = new SeededPRNG(this.startTimestamp)
        this.indexDrawPools = new IndexDrawPoolManager()
    }

    /**
     * Creates a clone of the current instance.
     *
     * @param {boolean} keepState - If true (default), the cloned instance will preserve the internal state
     * such as history, draw pool, and PRNG state. If false, the clone will be a fresh instance with the same path and meta
     * but without copying internal state — used for simulating behavior from a reset state.
     * 
     * @returns {this}
     */
    clone(keepState = true) {
        const cloned = Object.create(Object.getPrototypeOf(this))
        cloned.path = this.path
        cloned.meta = this.meta

        if (keepState) {
            cloned.segmentHistory = Array.from(this.segmentHistory)
            cloned.accumulatedTime = this.accumulatedTime
            cloned.segmentIndex = this.segmentIndex
            cloned.trackIndex = this.trackIndex
            cloned.PRNG = this.PRNG.clone()
            cloned.indexDrawPools = this.indexDrawPools.clone()
        }
        
        return cloned;
    }
    
    /**
     * Returns a segment from the station playlist relative to the current segment index.
     *
     * If the segment is not available in history, it simulates playback from the start to reconstruct it.
     * 
     * **Important:** RadioStation class implementations must ensure `historyLimit` is respected and `peekDepth` is being tracked to avoid infinite recursion.
     *
     * @param {number} segmentOffset
     *  + Positive for upcoming segments,
     *  + Negative for previous segments,
     *  + Zero for current segment
     * 
     * @returns {SegmentInfo|null} The segment at the given relative position, or null if out of bounds
     */
    peekSegment(segmentOffset) {
        if (segmentOffset <= 0) {
            const targetIndex = this.segmentIndex + segmentOffset
            if (targetIndex <= 0) return null

            const historyIndex = -segmentOffset
            if (historyIndex < this.segmentHistory.length) {
                return this.segmentHistory[historyIndex]
            }

            const simulatedStation = this.clone(false)
            simulatedStation.resetState()
    
            let segment = null
            for (let i = 0; i <= targetIndex; i++) { segment = simulatedStation.nextSegment() }
            return segment
            
        }

        const simulatedStation = this.clone()
        simulatedStation.peekDepth += 1

        let segment = null
        for (let i = 0; i < segmentOffset; i++) { segment = simulatedStation.nextSegment() }
        return segment
    }

    /**
     * Retrieves the next segment to play.
     *
     * This method also has side effects, such as incrementing `accumulatedTime`,
     * and modifying other internal state properties depending on the implementation. 
     *
     * @abstract
     * @returns {SyncedSegment} The next segment to be played.
     */
    nextSegment() { throw new Error("Method 'nextSegment()' must be implemented.") }

    /**
     * Retrieves the segment that is currently synced to time.
     * 
     * This method also has side effects, such as incrementing `accumulatedTime`,
     * and modifying other internal state properties depending on the implementation.
     * 
     * @returns {SyncedSegment}
     */
    getSyncedSegment() {
        this.resetState()
        
        const start = this.startTimestamp
        while (true) {
            const segment = this.nextSegment()
            const time = start + (this.accumulatedTime * 1000)

            if (time > Date.now()) { return segment }
        }
    }

    /**
     * Creates a new segment with a resolved path and startTimestamp
     * @param {SegmentInfo} segmentInfo
     * @returns {SyncedSegment}
     */
    newSyncedSegment(segmentInfo) {
        /** @type {SyncedSegment} */
        const segment = {
            ...this.resolveObjectPath(segmentInfo),
            startTimestamp: this.startTimestamp + (this.accumulatedTime * 1000)
        }
        delete segment["attachments"]
        delete segment["markers"]
        return segment
    }

    /**
     * Registers segment info into history, updates state and returns a synced segment
     * @param {SegmentInfo} segmentInfo
     * @returns {SyncedSegment}
     */
    registerSegment(segmentInfo) {
        this.segmentHistory.unshift(segmentInfo)
        if (this.segmentHistory.length > this._historyLimit) {
            this.segmentHistory.length = this._historyLimit
        }

        const syncedSegment = this.newSyncedSegment(segmentInfo) // must run before adding to accumulatedTime for correct timestamp

        if (segmentInfo.category == CAT_MUSIC) { this.trackIndex++ }
        this.segmentIndex++
        this.accumulatedTime += segmentInfo.audibleDuration || segmentInfo.duration
        return syncedSegment
    }
}

/** @param {number} categoryNum */
function getCategoryId(categoryNum) {
    switch (categoryNum) {
        case CAT_ADVERTS:
            return "advert"
        case CAT_IDENTS:
            return "id"
        case CAT_MUSIC:
            return "track"
        case CAT_DJSOLO:
            return "mono_solo"
    }
}

class StaticStation extends RadioStation {
    /** @type {"static"} */
    type = "static"

    nextSegment() {
        const segmentList = this.meta.fileGroups.track
        return this.registerSegment(segmentList[this.segmentIndex % segmentList.length])
    }
}

class TalkshowStation extends RadioStation {
    /** @type {"talkshow"} */
    type = "talkshow"

    getTrack() {
        const segmentList = this.meta.fileGroups.track
        const selectedSegment = segmentList[this.trackIndex % segmentList.length]
        selectedSegment.category = CAT_MUSIC
        return selectedSegment
    }

    getRandomTransition() {
        const transitions = this.meta.fileGroups.id
        const selectedTransition = transitions[this.indexDrawPools.nextUniqueIndex(getCategoryId(CAT_IDENTS), transitions.length, this.PRNG.next())]
        selectedTransition.category = CAT_IDENTS
        return selectedTransition
    }

    nextSegment() {
        const currentSegment = this.peekSegment(0)

        let segmentInfo
        if (currentSegment && currentSegment.category == 2) {
            segmentInfo = this.getRandomTransition()
        } else {
            segmentInfo = this.getTrack()
        }
        
        return this.registerSegment(segmentInfo)
    }
}

/** @param {import("./types").DJMarker[]} djMarkers */
function getDjSpeechWindows(djMarkers) {
    const intro = {}
    const outro = {}
    if (djMarkers) {
        for (const marker of djMarkers) {
            if (marker.value == "intro_start") {
                intro.start = marker.offset
            } else if (marker.value == "intro_end") {
                intro.end = marker.offset
            } else if (marker.value == "outro_start") {
                outro.start = marker.offset
            } else if (marker.value == "outro_end") {
                outro.end = marker.offset
            }
        }
    }
    return {intro, outro}
}

class DynamicStation extends RadioStation {
    /** @type {"dynamic"} */
    type = "dynamic"

    getRandomTrack(randNum) {
        const tracks = this.meta.fileGroups.track
        const selectedTrack = tracks[this.indexDrawPools.nextUniqueIndex("track", tracks.length, randNum)]
        selectedTrack.voiceovers = []
        selectedTrack.category = CAT_MUSIC

        const introList = selectedTrack?.attachments?.intro
        const markers = selectedTrack?.markers?.dj
        if (introList) {
            const selectedIntro = this.resolveObjectPath(introList[this.PRNG.next() % introList.length])
            const timeWindows = getDjSpeechWindows(markers)
            selectedIntro.offset = (timeWindows.intro.start || DEFAULT_DJ_SPEECH_OFFSET_MS) / 1000

            selectedTrack.voiceovers.push(selectedIntro)
        }

        return selectedTrack
    }

    getRandomTransition(randNum) {
        const select = (randNum % 2) == 0 ? CAT_IDENTS : CAT_DJSOLO
        const transitionType = getCategoryId(select)

        const transitions = this.meta.fileGroups[transitionType]
        const selectedTransition = transitions[this.indexDrawPools.nextUniqueIndex(transitionType, transitions.length, randNum)]
        selectedTransition.category = select
        return selectedTransition
    }

    nextSegment() {
        const randNum = this.PRNG.next()
        const randPercent = this.PRNG.toFloat(randNum) * 100
        const currentSegment = this.peekSegment(0)

        let segmentInfo
        if (currentSegment && currentSegment.category == CAT_MUSIC && randPercent < 50) {
            segmentInfo = this.getRandomTransition(randNum)
        } else {
            segmentInfo = this.getRandomTrack(randNum)
        }
      
        return this.registerSegment(segmentInfo)
    }
}
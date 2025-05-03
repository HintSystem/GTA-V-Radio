import { radioMeta, getDataPath } from "./constants.js"
import { SeededPRNG, IndexDrawPoolManager } from "./utility.js"

/**
 * @typedef {number} SegmentCategory
 * @readonly
 * @enum {number}
 */
const CAT = {
    ADVERTS: 0,
    IDENTS: 1,
    MUSIC: 2,
    NEWS: 3,
    DJSOLO: 5
}

/** @param {SegmentCategory} categoryValue */
export function getCategoryId(categoryValue) {
    switch (categoryValue) {
        case CAT.ADVERTS:
            return "adverts"
        case CAT.IDENTS:
            return "id"
        case CAT.MUSIC:
            return "track"
        case CAT.DJSOLO:
            return "mono_solo"
    }
}

const DEFAULT_DJ_INTRO_OFFSET_MS = 4000
const DEFAULT_DJ_OUTRO_OFFSET_MS = 4000

/** @typedef {import("./types").StationMetadata} StationMetadata */
/** @typedef {import("./types").SegmentInfo} SegmentInfo */
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
        return this._metaPromise
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
        if (object.path.split("/")[0] == "common") {
            info.path = getDataPath() + object.path
            return info
        }
        
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

export class PlayableSegment {
    /**
     * @param {SegmentInfo} segmentInfo 
     * @param {number} startTimestamp 
     */
    constructor(segmentInfo, startTimestamp) {
        /** @readonly @type {SegmentInfo} */
        this.info = segmentInfo
        /** @type {import("./types").VoiceoverInfo[]} - Chosen speeches for track, if any */
        this.voiceovers = []
        /** @type {number} - UTC time (in milliseconds) representing when the segment started playing */
        this.startTimestamp = startTimestamp
    }

    /** Gets the title for this segment, defaults to file name if it's a mix (used for logging) */
    getTitle() {
        const trackMarkers = this.info?.markers?.track
        if (trackMarkers && trackMarkers.length == 1) {
            const title = trackMarkers[0].title
            if (title) return title
        }

        const path = this.info.path.split("/")
        return path[path.length - 1]
    }

    getSpeechWindows() {
        /** @type {import("./types").DJMarker[]} */
        const djMarkers = this.info?.markers?.dj || []
        const intro = {}
        const outro = {}
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
        return {intro, outro}
    }
}

/**
 * Class that describes what a radio station must implement
 * @abstract
 * @extends {StationMeta} 
 */
export class RadioStation extends StationMeta {
    /** @readonly @type {StationType} */
    type
    /** @type {number} - Amount of time (in seconds) that has passed since the first track of the radio station played */
    accumulatedTime
    /** @type {number} - Current segment index */
    segmentIndex
    /** @type {number} - Current track index */
    trackIndex
    /** @type {SegmentInfo[]} */
    segmentHistory
    /** @private @type {number} */
    _historyLimit = 2
    /** @type {Record<string, SegmentInfo[]>} */
    commonListCache = {}
    
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
        cloned._historyLimit = this._historyLimit
        cloned.commonListCache = this.commonListCache

        if (keepState) {
            cloned.segmentHistory = Array.from(this.segmentHistory)
            cloned.accumulatedTime = this.accumulatedTime
            cloned.segmentIndex = this.segmentIndex
            cloned.trackIndex = this.trackIndex
            cloned.PRNG = this.PRNG.clone()
            cloned.indexDrawPools = this.indexDrawPools.clone()
        }
        
        return cloned
    }

    /**
     * Resolves details for playable segments.
     * 
     * Stations may implement this to customize playback transitions—typically by using `peekSegment()` 
     * to access upcoming or previous segments. For example, this can be used to add a voiceover 
     * that references the next track.
     *
     * @abstract
     * @protected
     * @param {PlayableSegment} playableSegment
     */
    impl_resolveSegment(playableSegment) {}

    /**
     * Retrieves information about the next segment to be played.
     * 
     * This method must be implemented by station subclasses to return the next `SegmentInfo` 
     * in the playback queue.
     * 
     * **IMPORTANT**: Do not use `peekSegment()` to access future segments within this method, as it *will* 
     * result in infinite recursion. `peekSegment()` may only be used to inspect **past segments**, 
     * and must respect the defined `historyLimit`.
     *
     * @abstract
     * @protected
     * @returns {SegmentInfo} The next segment to be played.
     */
    impl_nextSegment() { throw new Error("Method 'nextSegment()' must be implemented.") }

    /**
     * Returns a segment from the station playlist relative to the current segment index.
     *
     * If the segment is not available in history, it simulates playback from the start to reconstruct it.
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

            // Reset station state and simulate tracks from beginning
            const simulatedStation = this.clone(false)
            simulatedStation.resetState()
    
            let segment = null
            for (let i = 0; i <= targetIndex; i++) {
                segment = simulatedStation._nextSegmentInfo()
            }
            return segment
        }

        // Clone station state and continue simulating tracks ahead
        const simulatedStation = this.clone()

        let segment = null
        for (let i = 0; i < segmentOffset; i++) {
            segment = simulatedStation._nextSegmentInfo()
        }
        return segment
    }

    /**
     * Retrieves information about the next segment.
     *
     * This method affects station state, such as incrementing `accumulatedTime`,
     * and modifying other internal state properties.
     *
     * @returns {PlayableSegment} The next segment to be played.
     */
    nextSegment() {
        return this._nextSegmentInfo((segmentInfo) => {
            return this._newPlayableSegment(segmentInfo)
        })
    }

    /**
     * Retrieves the segment that is currently synced to time.
     * 
     * This method affects station state, such as incrementing `accumulatedTime`,
     * and modifying other internal state properties.
     * 
     * @returns {PlayableSegment}
     */
    getSyncedSegment() {
        this.resetState()
        
        const now = Date.now() - this.startTimestamp
        while (true) {
            const segment = this._nextSegmentInfo((segmentInfo) => {
                const segmentDuration = segmentInfo.audibleDuration || segmentInfo.duration
                const time = (this.accumulatedTime + segmentDuration) * 1000

                if (time > now) { return this._newPlayableSegment(segmentInfo) }
                return null
            })
    
            if (segment) { return segment }
        }
    }

    /**
     * @protected
     * @param {"adverts" | "news"} listCategory
     */
    getCommonList(listCategory) {
        let resultList = this.commonListCache[listCategory] || []
        if (resultList.length != 0) { return this.commonListCache[listCategory] }

        if (listCategory in this.meta.fileGroups) {
            resultList = this.meta.fileGroups[listCategory]
        }

        if (listCategory in this.meta.common) {
            for (const listId of this.meta.common[listCategory]) {
                resultList = resultList.concat(radioMeta.common[listId])
            }
        }

        this.commonListCache[listCategory] = resultList
        return resultList
    }

    /** 
     * @private
     * @overload
     * @returns {SegmentInfo}
     */
    /** 
     * @private
     * @template T
     * @overload
     * @param {((segmentInfo: SegmentInfo) => T)} onAfterRegister - Optional callback executed after registering `SegmentInfo` to history but before updating station state. If provided, the callback's return value is returned.
     * @returns {T}
     */
    _nextSegmentInfo(onAfterRegister = null) {
        const segmentInfo = this.impl_nextSegment()

        // Register in history
        this.segmentHistory.unshift(segmentInfo)
        if (this.segmentHistory.length > this._historyLimit) {
            this.segmentHistory.length = this._historyLimit
        }
    
        let returnValue = segmentInfo
        if (onAfterRegister) {
            const segmentIndex = this.PRNG.index
            returnValue = onAfterRegister(segmentInfo)
            this.PRNG.index = segmentIndex
        }

        // Update state
        if (segmentInfo.category === CAT.MUSIC) this.trackIndex++
        this.segmentIndex++
        this.accumulatedTime += segmentInfo.audibleDuration || segmentInfo.duration
    
        return returnValue
    }

    /**
     * Creates a new playable segment with a resolved path, startTimestamp and voiceovers
     * @private
     * @param {SegmentInfo} segmentInfo
     * @returns {PlayableSegment}
     */
    _newPlayableSegment(segmentInfo) {
        const segment = this.resolveObjectPath(segmentInfo)

        const playableSegment = new PlayableSegment(segment, this.startTimestamp + (this.accumulatedTime * 1000))
        this.impl_resolveSegment(playableSegment)
        return playableSegment
    }
}

/**
 * @template T
 * @param {T & import("./types.js").RelativeAudioInfo} segmentInfo
 * @param {SegmentCategory} category
 * @returns {SegmentInfo}
 */
function setSegmentCategory(segmentInfo, category) {
    return Object.assign({ category }, segmentInfo) // Clone segmentInfo, category won't be included in every referenced segmentInfo
}

class StaticStation extends RadioStation {
    /** @readonly @type {"static"} */
    type = "static"

    impl_nextSegment() {
        const segmentList = this.meta.fileGroups.track
        return setSegmentCategory(segmentList[this.segmentIndex % segmentList.length], CAT.MUSIC)
    }
}

class TalkshowStation extends RadioStation {
    /** @readonly @type {"talkshow"} */
    type = "talkshow"

    getTrack() {
        const segmentList = this.meta.fileGroups.track
        return segmentList[this.trackIndex % segmentList.length]
    }

    getRandomTransition(currentCategory) {
        let category, transitions
        if (currentCategory == CAT.ADVERTS || currentCategory == CAT.NEWS) {
            category = CAT.IDENTS
            transitions = this.meta.fileGroups.id
        } else {
            category = CAT.ADVERTS
            transitions = this.getCommonList("adverts")
        }

        if (!transitions || transitions.length === 0) return null

        const segmentInfo = transitions[this.indexDrawPools.nextUniqueIndex(getCategoryId(category), transitions.length, this.PRNG.next())]
        return setSegmentCategory(segmentInfo, category)
    }

    impl_nextSegment() {
        const currentCategory = this.peekSegment(0)?.category

        if ([CAT.MUSIC, CAT.NEWS, CAT.ADVERTS].includes(currentCategory)) {
            const transition = this.getRandomTransition(currentCategory)
            if (transition) return transition
        }
        
        return setSegmentCategory(this.getTrack(), CAT.MUSIC)
    }
}

class DynamicStation extends RadioStation {
    /** @readonly @type {"dynamic"} */
    type = "dynamic"

    getRandomTrack(randNum) {
        const tracks = this.meta.fileGroups.track
        return tracks[this.indexDrawPools.nextUniqueIndex("track", tracks.length, randNum)]
    }

    getRandomTransition(randNum) {
        let select = randNum % 2 == 0 ? CAT.DJSOLO : CAT.ADVERTS

        const categoryId = getCategoryId(select)
        let transitions
        if (select == CAT.ADVERTS) {
            transitions = this.getCommonList("adverts")
        } else {
            transitions = this.meta.fileGroups[categoryId]
        }

        const segmentInfo = transitions[this.indexDrawPools.nextUniqueIndex(categoryId, transitions.length, randNum)]
        return setSegmentCategory(segmentInfo, select)
    }

    getRandomId(randNum) {
        const category = getCategoryId(CAT.IDENTS)
        const idents = this.meta.fileGroups[category]

        if (!idents || idents.length === 0) return null

        const segmentInfo = idents[this.indexDrawPools.nextUniqueIndex(category, idents.length, randNum)]
        return setSegmentCategory(segmentInfo, CAT.IDENTS)
    }

    /** @param {PlayableSegment} playableSegment  */
    impl_resolveSegment(playableSegment) {
        const nextSegment = this.peekSegment(1)
        const segmentInfo = playableSegment.info
        
        const timeWindows = playableSegment.getSpeechWindows()
        const introList = segmentInfo?.attachments?.intro
        if (introList) {
            const selectedIntro = this.resolveObjectPath(introList[this.PRNG.next() % introList.length])
            selectedIntro.offset = (timeWindows.intro.start || DEFAULT_DJ_INTRO_OFFSET_MS) / 1000

            playableSegment.voiceovers.push(selectedIntro)
        }

        const toAdsList = this.meta.fileGroups?.to_adverts
        const toNewsList = this.meta.fileGroups?.to_news
        if (nextSegment.category == CAT.ADVERTS && toAdsList) {
            const selectedOutro = /** @type {any} */ (this.resolveObjectPath(toAdsList[this.indexDrawPools.nextUniqueIndex("to_ad", toAdsList.length, this.PRNG.next())]))
            selectedOutro.offset = ((timeWindows.outro?.end || (segmentInfo.duration - DEFAULT_DJ_OUTRO_OFFSET_MS)) - selectedOutro.duration) / 1000

            playableSegment.voiceovers.push(selectedOutro)
        }
    }

    impl_nextSegment() {
        const randNum = this.PRNG.next()
        const randPercent = this.PRNG.toFloat(randNum) * 100
        const currentCategory = this.peekSegment(0)?.category

        let segmentInfo
        if (currentCategory == CAT.ADVERTS) {
            segmentInfo = this.getRandomId(randNum)
        } else if (currentCategory == CAT.MUSIC && randPercent < 50) {
            segmentInfo = this.getRandomTransition(randNum)
        }

        if (segmentInfo) { return segmentInfo }

        return setSegmentCategory(this.getRandomTrack(randNum), CAT.MUSIC)        
    }
}
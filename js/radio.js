import { getDataPath } from "./constants.js"

let seed = 1234
let rngIndex = 0
function seededPRNG() {
    // Simple hash function (xorshift-style)
    let value = seed ^ rngIndex;
    value = (value ^ (value >>> 21)) * 0x45d9f3b;
    value = (value ^ (value >>> 15)) * 0x45d9f3b;
    value = value ^ (value >>> 13);

    // Ensure value is a positive integer
    value = value >>> 0;

    rngIndex++
    return value
}

/** @typedef { import("./radio").SegmentInfo } SegmentInfo */
/** @typedef { import("./radio").SyncedSegment } SyncedSegment */

/** @typedef {"dynamic" | "talkshow" | "static"} StationType */

/**
 * Metadata for a radio station
 * @property {string} path - Path to station
 * @property {?Object} meta - Metadata object or null if not yet loaded
 */
export class StationMeta {
    constructor(path, meta = null) {
        this.path = path
        this.meta = meta

        /**
         * @private
         * @type {?Promise<Object>}
         */
        this._metaPromise = null
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

    getAbsolutePath(relativePath) {
        return getDataPath() + this.path + "/" + relativePath
    }

    /**
     * Returns a cloned object with a resolved path by turning a relative path into an absolute one, based on the radio station path
     * @template {{path: string}} T
     * @param {T} object 
     * @returns {T}
     */
    resolveObjectPath(object) {
        const info = Object.assign({}, object)
        info.path = this.getAbsolutePath(object.path)
        return info
    }

    getIcon(type) {
        if (!this.meta) { return undefined }

        const icon = this.meta.info.icon[type]
        if (icon) { return this.getAbsolutePath(icon) }
        return undefined
    }

    /** Tries to get preffered icon type, defaults to closest alternative otherwise */
    getPrefferedIcon(type) {
        const priority = ["color", "monochrome", "full"]

        let icon = this.getIcon(type)
        let index = 0
        while (!icon) {
            const newIconType = priority[index]
            index++
            
            if (newIconType != type) { return this.getIcon(newIconType) }
            if (index >= priority.length) { return undefined }
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
    /** @type {number} - The amount of time that has passed since the first track of the radio station played (required for getting a synced segment) */
    accumulatedTime

    constructor(path, meta) {
        super(path, meta)
        if (this.constructor === RadioStation) { throw new Error("Abstract class 'RadioStation' cannot be instantiated directly.") }

        this.accumulatedTime = 0
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
     * @abstract
     * @returns {SyncedSegment}
     */
    getSyncedSegment() { throw new Error("Method 'getSyncedSegment()' must be implemented.") }

    /**
     * Creates a new segment with a resolved path and startTimestamp
     * @param {SegmentInfo} segmentInfo
     * @param {number} accumulatedTime - amount of time passed in seconds since the reset of the radio station to reach this synced segment
     * @returns {SyncedSegment}
     */
    newSyncedSegment(segmentInfo, accumulatedTime) {
        const segment = this.resolveObjectPath(segmentInfo)
        segment.startTimestamp = this.startTimestamp + (accumulatedTime * 1000)
        return segment
    }

    /**
     * UTC time (in milliseconds) when the radio station playback sync was reset (resets every month)
     * @type {number}
     */
    get startTimestamp() { return Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) }
}

class StaticStation extends RadioStation {
    constructor(path, meta) {
        super(path, meta)
        this.segmentIndex = 0
        this.type = "static"
    }

    nextSegment() {
        const segmentList = this.meta.fileGroups.track
        const segment = this.newSyncedSegment(segmentList[this.segmentIndex % segmentList.length], this.accumulatedTime)
        
        this.segmentIndex++
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
        rngIndex = 0
        this.segmentIndex = 0
        this.accumulatedTime = 0
        
        const start = this.startTimestamp
        while (true) {
            const segment = this.nextSegment()
            const time = start + (this.accumulatedTime * 1000)

            if (time > Date.now()) { return segment }
        }
    }
}

class TalkshowStation extends RadioStation {
    constructor(path, meta) {
        super(path, meta)
        this.segmentIndex = 0
        this.prevSegment = null
        this.type = "talkshow"
    }

    getTrack() {
        const segmentList = this.meta.fileGroups.track
        return segmentList[this.segmentIndex % segmentList.length]
    }

    getRandomTransition(randNum) {
        const segmentList = this.meta.fileGroups.id
        return segmentList[randNum % segmentList.length]
    }

    nextSegment() {
        const randNum = seededPRNG()
        const randPercent = (randNum / 0xFFFFFFFF) * 100

        const isTrack = this.prevSegment === null || !this.prevSegment.isTrack || randPercent < 50
        const segmentInfo = isTrack ? this.getTrack() : this.getRandomTransition(randNum)

        const segment = this.newSyncedSegment(segmentInfo, this.accumulatedTime)
        segment.isTrack = isTrack
        
        this.segmentIndex++
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
        rngIndex = 0
        this.segmentIndex = 0
        this.accumulatedTime = 0
        this.prevSegment = null
        
        const start = this.startTimestamp
        while (true) {
            const segment = this.nextSegment()
            const time = start + (this.accumulatedTime * 1000)

            if (time > Date.now()) { return segment }
        }
    }
}

class DynamicStation extends RadioStation {
    constructor(path, meta) {
        super(path, meta)
        this.prevSegment = null
        this.type = "dynamic"
    }

    getRandomTrack(randNum) {
        const tracks = this.meta.fileGroups.track
        const selectedTrack = tracks[randNum % tracks.length]

        if (selectedTrack.voiceovers) {
            const voiceovers = selectedTrack.voiceovers
            selectedTrack.voiceOver = this.resolveObjectPath(voiceovers[seededPRNG() % voiceovers.length])
        }

        return selectedTrack
    }

    getRandomTransition(randNum) {
        const select = randNum % 2
        const transitions = this.meta.fileGroups[ select == 0 ? "id" : "mono_solo" ]
        const selectedTransition = transitions[randNum % transitions.length]

        return selectedTransition
    }

    nextSegment() {
        const randNum = seededPRNG()
        const randPercent = (randNum / 0xFFFFFFFF) * 100

        const isTrack = this.prevSegment === null || !this.prevSegment.isTrack || randPercent < 50
        const segmentInfo = isTrack ? this.getRandomTrack(randNum) : this.getRandomTransition(randNum)

        const segment = this.newSyncedSegment(segmentInfo, this.accumulatedTime)
        segment.isTrack = isTrack

        this.prevSegment = segment
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
        rngIndex = 0
        this.accumulatedTime = 0
        this.prevSegment = null
        
        const start = this.startTimestamp
        while (true) {
            const segment = this.nextSegment()
            const time = start + (this.accumulatedTime * 1000)

            if (time > Date.now()) { return segment }
        }
    }
}
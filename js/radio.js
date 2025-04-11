import { getDataPath } from "./constants.js"
import { SeededPRNG, IndexDrawPoolManager } from "./utility.js"

const PRNG = new SeededPRNG(1)

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
     * @returns {string|undefined}
     */
    getIcon(type) {
        if (!this.meta) { return undefined }

        const icon = this.meta.info.icon[type]
        if (icon) { return this.getAbsolutePath(icon) }
        return undefined
    }

    /**
     * Tries to get preffered icon type, defaults to closest alternative otherwise
     * @param {IconType} type
     * @returns {string|undefined}
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

        PRNG.seed = this.startTimestamp // seed needs to reset every month
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
        /** @type {SyncedSegment} */
        const segment = {
            ...this.resolveObjectPath(segmentInfo),
            startTimestamp: this.startTimestamp + (accumulatedTime * 1000)
        }
        delete segment["voiceovers"]
        return segment
    }

    /**
     * UTC time (in milliseconds) when the radio station playback sync was reset (resets every month)
     * @type {number}
     */
    get startTimestamp() { return Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) }
}

class StaticStation extends RadioStation {
    /** @type {"static"} */
    type = "static"

    constructor(path, meta) {
        super(path, meta)
        this.segmentIndex = 0
    }

    nextSegment() {
        const segmentList = this.meta.fileGroups.track
        const segment = this.newSyncedSegment(segmentList[this.segmentIndex % segmentList.length], this.accumulatedTime)
        
        this.segmentIndex++
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
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
    /** @type {"talkshow"} */
    type = "talkshow"

    constructor(path, meta) {
        super(path, meta)
        this.segmentIndex = 0
        this.prevSegment = null
        this.indexDrawPools = new IndexDrawPoolManager()
    }

    getTrack() {
        const segmentList = this.meta.fileGroups.track
        return segmentList[this.segmentIndex % segmentList.length]
    }

    getRandomTransition() {
        const transitions = this.meta.fileGroups.id
        return transitions[this.indexDrawPools.nextUniqueIndex("id", transitions.length, PRNG.next())]
    }

    nextSegment() {
        const isTrack = this.prevSegment === null || !this.prevSegment.isTrack
        const segmentInfo = isTrack ? this.getTrack() : this.getRandomTransition()

        const segment = this.newSyncedSegment(segmentInfo, this.accumulatedTime)
        segment.isTrack = isTrack
        
        if (isTrack) { this.segmentIndex++ }
        this.prevSegment = segment
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
        PRNG.index = 0
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
    /** @type {"dynamic"} */
    type = "dynamic"

    constructor(path, meta) {
        super(path, meta)
        this.prevSegment = null
        this.indexDrawPools = new IndexDrawPoolManager()
    }

    getRandomTrack(randNum) {
        const tracks = this.meta.fileGroups.track
        const selectedTrack = tracks[this.indexDrawPools.nextUniqueIndex("track", tracks.length, randNum)]

        if (selectedTrack.voiceovers) {
            const voiceovers = selectedTrack.voiceovers
            selectedTrack.voiceOver = this.resolveObjectPath(voiceovers[PRNG.next() % voiceovers.length])
        }

        return selectedTrack
    }

    getRandomTransition(randNum) {
        const select = randNum % 2
        const transitionType = select == 0 ? "id" : "mono_solo"
        const transitions = this.meta.fileGroups[transitionType]

        return transitions[this.indexDrawPools.nextUniqueIndex(transitionType, transitions.length, randNum)]
    }

    nextSegment() {
        const randNum = PRNG.next()
        const randPercent = PRNG.toFloat(randNum) * 100

        const isTrack = this.prevSegment === null || !this.prevSegment.isTrack || randPercent < 50
        const segmentInfo = isTrack ? this.getRandomTrack(randNum) : this.getRandomTransition(randNum)

        const segment = this.newSyncedSegment(segmentInfo, this.accumulatedTime)
        segment.isTrack = isTrack

        this.prevSegment = segment
        this.accumulatedTime += segment.audibleDuration || segment.duration
        return segment
    }

    getSyncedSegment() {
        PRNG.index = 0
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
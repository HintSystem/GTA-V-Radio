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

export class StationMeta {
    constructor(path, meta = null) {
        this.path = path
        this.meta = meta
        this._metaPromise = null
    }

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
                    console.error(`Failed to load "${this.path}" metadata:`, err);
                });
        }
        return this._metaPromise;
    }

    getAbsolutePath(relativePath) {
        return getDataPath() + this.path + "/" + relativePath
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
 * @abstract
 * @extends {StationMeta}
 */
export class RadioStation extends StationMeta {
    constructor(path, meta) {
        super(path, meta)
        if (this.constructor === RadioStation) { throw new Error("Abstract class 'RadioStation' cannot be instantiated directly.") }

        this.accumulatedTime = 0
        this.type = ""
    }

    /**
     * Get the next segment to play
     * @abstract
     */
    nextSegment() { throw new Error("Method 'nextSegment()' must be implemented.") }

    /**
     * Get the segment that is currently synced to time
     * @abstract
     */
    getSyncedSegment() { throw new Error("Method 'getSyncedSegment()' must be implemented.") }

    /** Creates a new segment without object reference mutation and normalizes path */
    newSegment(segmentInfo) {
        const segment = Object.assign({}, segmentInfo)
        segment.path = this.getAbsolutePath(segmentInfo.path)
        return segment
    }

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
        
        this.segmentIndex++
        return this.newSegment(segmentList[this.segmentIndex % segmentList.length])
    }

    getSyncedSegment() {
        rngIndex = 0
        this.segmentIndex = 0
        this.accumulatedTime = 0
        
        const start = this.startTimestamp
        let lastTime = 0
        while (true) {
            const segment = this.nextSegment()
            const duration = segment.audibleDuration || segment.duration
            this.accumulatedTime += duration

            const time = start + (this.accumulatedTime * 1000)
            if (time > Date.now()) {
                return [segment, (Date.now() - lastTime) / 1000]
            }
            lastTime = time
        }
    }
}

class TalkshowStation extends RadioStation {
    constructor(path, meta) {
        super(path, meta)
        this.prevSegment = undefined
        this.segmentIndex = 0
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

        const isTrack = this.prevSegment === undefined || !this.prevSegment.isTrack || randPercent < 50
        const segment = this.newSegment(isTrack ? this.getTrack() : this.getRandomTransition(randNum))
        
        this.segmentIndex++
        return segment
    }

    getSyncedSegment() {
        rngIndex = 0
        this.segmentIndex = 0
        this.accumulatedTime = 0
        
        const start = this.startTimestamp
        let lastTime = 0
        while (true) {
            const segment = this.nextSegment(false)
            const duration = segment.audibleDuration || segment.duration
            this.accumulatedTime += duration

            const time = start + (this.accumulatedTime * 1000)
            if (time > Date.now()) {
                return [segment, (Date.now() - lastTime) / 1000]
            }
            lastTime = time
        }
    }
}

class DynamicStation extends RadioStation {
    constructor(path, meta) {
        super(path, meta)
        this.prevSegment = undefined
        this.type = "dynamic"
    }

    getRandomTrack(randNum) {
        const tracks = this.meta.fileGroups.track
        const selectedTrack = tracks[randNum % tracks.length]

        if (selectedTrack.voiceovers) {
            const voiceovers = selectedTrack.voiceovers
            selectedTrack.voiceOver = this.newSegment(voiceovers[seededPRNG() % voiceovers.length])
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

        const isTrack = this.prevSegment === undefined || !this.prevSegment.isTrack || randPercent < 50

        const segment = this.newSegment(isTrack ? this.getRandomTrack(randNum) : this.getRandomTransition(randNum))
        segment.isTrack = isTrack
        
        this.prevSegment = segment
        return segment
    }

    getSyncedSegment() {
        rngIndex = 0
        this.prevSegment = undefined
        this.accumulatedTime = 0
        
        const start = this.startTimestamp
        let lastTime = 0
        while (true) {
            const segment = this.nextSegment()
            const duration = segment.audibleDuration || segment.duration
            this.accumulatedTime += duration

            const time = start + (this.accumulatedTime * 1000)
            if (time > Date.now()) {
                return [segment, (Date.now() - lastTime) / 1000]
            }
            lastTime = time
        }
    }
}
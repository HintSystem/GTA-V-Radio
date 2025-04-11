// @ts-ignore
let audioContext = new (window.AudioContext || window.webkitAudioContext)()

/** @typedef {import("./types").AudioInfo} AudioInfo */
export class AudioManager {
    /** @type {HTMLAudioElement} */
    audio
    /** @type {MediaElementAudioSourceNode} */
    source
    /** @private @type {() => void} */
    _onSync
    /** @private @type {number} */
    _syncInterval

    /**
     * @param {AudioInfo | {path: string, [key: string]: any} | HTMLAudioElement} audioInfo
     * @param {AudioNode?} connection - node to connect to
     * @param {boolean} autoDestroy - when set to True, destroys the audio on end
     */
    constructor(audioInfo, connection = null, autoDestroy = false) {
        if (audioInfo instanceof HTMLAudioElement) {
            this.audio = audioInfo
        } else {
            this.info = audioInfo
            this.audio = new Audio(this.info.path)
        }

        this.audio.crossOrigin = "anonymous"
        this.source = audioContext.createMediaElementSource(this.audio)
        
        if (connection) { this.source.connect(connection) }
        if (autoDestroy) { this.audio.addEventListener("ended", () => this.destroy()) }
    }

    resume() { this.audio.play(); }

    pause() { this.audio.pause() }

    stop() { this.audio.pause(); this.audio.currentTime = 0 }

    play() { this.audio.currentTime = 0; this.audio.play() }

    get isBuffering() { return this.audio.readyState < 4 && !this.audio.paused }

    /**
     * Plays the audio synchronized to a timestamp.
     * @param {number} timestamp - UTC time (in milliseconds) representing when the audio originally started
     */
    playSynced (timestamp) {
        if (this._onSync) {
            this.audio.removeEventListener("playing", this._onSync)
            this._onSync = null
        }
        if (this._syncInterval) {
            clearInterval(this._syncInterval)
            this._syncInterval = null
        }

        if (timestamp) {
            this._onSync = () => {
                const audioTime = (Date.now() - timestamp) / 1000
                const desync = audioTime - this.audio.currentTime
                const desyncThreshold = 0.8

                if (this.audio.currentTime > 0.1) { console.log(`audio desync: ${desync}, time: ${this.audio.currentTime}, '${this.info.path}'`, ) }
                if (desync > desyncThreshold) { this.audio.currentTime = audioTime }
            }
            this._onSync()
            this._syncInterval = setInterval(() => {
                if (!this.isBuffering) { this._onSync() }
            }, 8000)
            this.audio.addEventListener("playing", this._onSync)
        }
        this.audio.play()
    }

    /**
     * Executes callback until audio has reached the time defined in delay
     * @param {() => void} callback
     * @param {number} delay - amount of time to wait in seconds
     */
    setTimeout(callback, delay) {
        if (this.audio.currentTime > delay) { return }

        const onTimeUpdate = () => {
            if (this.audio.currentTime >= delay) {
                this.audio.removeEventListener('timeupdate', onTimeUpdate)
                callback()
            }
        };

        this.audio.addEventListener('timeupdate', onTimeUpdate)
    }

    /**
     * Executes callback when audio has audibly ended
     * @param {() => void} callback
     */
    onAudibleEnd(callback) {
        if (this.info.audibleDuration) {
            this.setTimeout(callback, this.info.audibleDuration)
        } else {
            this.audio.addEventListener("ended", callback)
        }
    }

    destroy() {
        if (this._syncInterval) {
            clearInterval(this._syncInterval)
            this._syncInterval = null
        }

        if (this.audio) {
            this.stop()
            this.audio.removeAttribute("src")
            this.audio.load()
        }

        if (this.source) {
            this.source.disconnect()
            this.source = null
        }
    }
}

const masterGain = audioContext.createGain()
masterGain.gain.value = 0.5
masterGain.connect(audioContext.destination)

const trackGain = audioContext.createGain()
trackGain.connect(masterGain)

/** @type {?AudioManager} */
export let MainTrack = null
/** @type {?AudioManager} */
export let VoiceOverTrack = null

export function stopAudioTracks() {
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceOverTrack) { VoiceOverTrack.destroy() }
}

/**
 * @param {import("./radio").SyncedSegment} segment 
 */
export function playSegment(segment) {
    MainTrack = new AudioManager(segment, trackGain, true)
    MainTrack.playSynced(segment.startTimestamp)

    if (segment.voiceOver) {
        VoiceOverTrack = new AudioManager(segment.voiceOver, masterGain, true)

        VoiceOverTrack.audio.addEventListener("ended", () => {
            trackGain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 2)
        })
        MainTrack.setTimeout(() => {
            trackGain.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 2)
            VoiceOverTrack.play()
        }, 5)
    }
}

export default { context: audioContext, masterGain, trackGain }
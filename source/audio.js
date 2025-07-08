import { logs } from "./debug/logging.js"
import { audioSettings } from "./settings.js"
import { PlayableSegment } from "./radio.js"

/** @type {AudioContext} */
// @ts-ignore
let audioContext = new (window.AudioContext || window.webkitAudioContext)()

const AUDIO_PREPLAY_TIME = 0.8 // Execute onAudibleEnd and play audio 800ms early to reduce sync jumps
const AUDIO_DESYNC_THRESHOLD = 200 // Firefox fingerprint protection can reduce time precision to 100m so have to take that into consideration
const AUDIO_SYNC_INTERVAL_MS = 8000

const DUCK_RAMP_PREEMPT_TIME = 2 // AudioContext sometimes fails to work when scheduling value changes right away so some buffer time is required

/** @typedef {import("./types.js").AudioInfo} AudioInfo */
export class AudioManager {
    /** @type {MediaElementAudioSourceNode} */
    source
    /** @type {boolean} */
    ended = false
    /** @type {(() => void) | null} */
    onDestroy = null
    /** @type {number | null} */
    syncTimestamp = null
    /** @private @type {(() => void) | null} */
    _onCanPlaySync = null
    /** @private @type {number | null} */
    _syncInterval = null
    /** @private @type {number | null} */
    _awaitSyncTimeout = null
    /** @private @type {boolean} */
    _connected = false

    /**
     * @param {AudioInfo | {path: string, [key: string]: any}} audioInfo
     * @param {AudioNode?} connection - Node to connect to
     * @param {boolean} autoDestroy - When set to true, destroys audio on end
     */
    constructor(audioInfo, connection = null, autoDestroy = false) {
        /** @type {AudioNode?} */
        this.connection = connection
        this.info = audioInfo
        /** @type {HTMLAudioElement} */
        this.audio = new Audio(this.info.path)

        this.audio.crossOrigin = "anonymous"
        this.audio.addEventListener("ended", () => {
            this.ended = true
            if (autoDestroy) this.destroy()
        })
    }

    /** Current playback position in seconds. More precise if using playSynced. */
    get currentTime() {
        if (this.syncTimestamp) return (Date.now() - this.syncTimestamp) / 1000
        return this.audio.currentTime
    }

    /** @private */
    _ensureConnected() {
        if (!this.source) { this.source = audioContext.createMediaElementSource(this.audio) }

        if (!this._connected && this.connection) {
            this.source.connect(this.connection)
            this._connected = true
        }
    }

    resume() {
        this.ended = false
        this._ensureConnected()
        this.audio.play()
    }

    pause() { this.audio.pause() }

    stop() { this.audio.pause(); this.audio.currentTime = 0 }

    /** @param {number} startTime */
    play(startTime = 0) {
        this._ensureConnected()
        this.audio.currentTime = startTime
        this.audio.play()
    }

    get isBuffering() { return this.audio.readyState < 4 && !this.audio.paused }

    /**
     * Plays the audio synchronized to a timestamp.
     * @param {number} timestamp - UTC time (in milliseconds) representing when the audio originally started
     */
    playSynced (timestamp) {
        this._cleanupSync()
        this.stop()

        if (!Number.isFinite(timestamp)) { throw new Error("Cannot run playSynced() when timestamp is not a finite number") }
        this.syncTimestamp = timestamp

        const audio = this.audio
        function getSyncInfo() {
            const audioTime = Date.now() - timestamp
            return { audioTime: audioTime / 1000, desyncMs: audioTime - (audio.currentTime * 1000) }
        }

        function syncAudio(force = false) {
            const { audioTime, desyncMs } = getSyncInfo()
            
            if (force || Math.abs(desyncMs) > AUDIO_DESYNC_THRESHOLD) {
                logs.logJump(desyncMs)
                audio.currentTime = audioTime
            } else if (audio.currentTime > 0) {
                logs.logDesync(desyncMs, audioTime)
            }
        }

        const waitUntilAudioTime = () => {
            const { audioTime } = getSyncInfo()
            if (audioTime < -0.1) {
                console.log(`Waiting for synced audio to begin... (${audioTime.toFixed(4)}s)`)
                this._awaitSyncTimeout = setTimeout(waitUntilAudioTime, Math.min(-audioTime * 1000 - 50, 4000)) // Check if audioTime > 0 every 4 seconds
            } else {
                syncAudio()

                this._syncInterval = setInterval(() => {
                    if (!this.isBuffering) syncAudio()
                }, AUDIO_SYNC_INTERVAL_MS)

                this._onCanPlaySync = () => {
                    syncAudio(true) // Force sync because waiting for audio will cause delays
                    setTimeout(() => {
                        if (!this._onCanPlaySync) return
                        audio.addEventListener("canplay", this._onCanPlaySync, { once: true })
                    }, 100) // Delay new event listener to prevent feedback loop caused by setting currentTime
                }
                audio.addEventListener("canplay", this._onCanPlaySync, { once: true })

                this.resume()
            }
        }
        waitUntilAudioTime()
    }

    /**
     * Executes callback once audio time reaches delay
     * @param {() => void} callback
     * @param {number} delay - Delay (in seconds)
     * @param {boolean} alwaysRun - If true, executes callback even if currentTime already passed delay
     */
    setTimeout(callback, delay, alwaysRun = false) {
        if (this.currentTime > delay || this.ended) {
            if (alwaysRun) callback()
            return
        }

        const onTimeUpdate = () => {
            if (this.currentTime >= delay) {
                this.audio.removeEventListener('timeupdate', onTimeUpdate)
                callback()
            }
        };

        this.audio.addEventListener('timeupdate', onTimeUpdate)
    }

    /**
     * Executes callback when audio has audibly ended. Will run instantly if already ended.
     * @param {() => void} callback
     */
    onAudibleEnd(callback) {
        if (this.ended) { callback(); return }

        let duration = this.info.audibleDuration || this.info.duration  
        if (duration) {
            this.setTimeout(callback, Math.min(duration, (this.info.duration - AUDIO_PREPLAY_TIME)), true)
        } else {
            this.audio.addEventListener("ended", callback)
        }
    }

    /**
     * Schedules a ducking ramp to be executed ahead of time
     * @param {GainNode} gainNode 
     * @param {number} startTime 
     * @param {number} rampDuration 
     * @param {number} startGain 
     * @param {number} endGain
     * @returns {boolean} True if ramp was successful, false if ramp was skipped
     */
    scheduleDuckingRamp(gainNode, startTime, rampDuration, startGain, endGain) {
        const audioTime = this.currentTime

        // Ramp has not started - schedule fully
        if (audioTime < startTime) {
            const preemptMax = (startTime - audioTime - 0.1)
            const preemptTime = Math.min(DUCK_RAMP_PREEMPT_TIME, preemptMax)

            this.setTimeout(() => {
                gainNode.gain.setValueCurveAtTime([startGain, endGain], audioContext.currentTime + preemptTime, rampDuration)
            }, startTime - preemptTime)
            return true
        }

        // Ramp finished or midway - set final value
        gainNode.gain.value = endGain
        return false
    }

    /** @private */
    _cleanupSync() {
        this.syncTimestamp = null
        if (this._onCanPlaySync) {
            this.audio.removeEventListener("canplay", this._onCanPlaySync)
            this._onCanPlaySync = null
        }
        if (this._syncInterval) {
            clearInterval(this._syncInterval)
            this._syncInterval = null
        }
        if (this._awaitSyncTimeout) {
            clearTimeout(this._awaitSyncTimeout)
            this._awaitSyncTimeout = null
        }
    }

    destroy() {
        this.ended = true
        this._cleanupSync()
        
        if (this.audio) {
            this.audio.pause()
            this.audio.removeAttribute("src")
            this.audio.load()
        }
        
        if (this.source) {
            this.source.disconnect()
            this.source = null
        }
        if (this.onDestroy) { this.onDestroy() }
    }
}

const masterGain = audioContext.createGain()
masterGain.connect(audioContext.destination)

const musicGain = audioContext.createGain()
musicGain.connect(masterGain)

const speechGain = audioContext.createGain()
speechGain.connect(masterGain)

const sfxGain = audioContext.createGain()
sfxGain.connect(masterGain)

audioSettings.subscribe((key, value) => {
    switch (key) {
        case "masterGain":
            masterGain.gain.value = value * 0.8
            break
        case "musicGain":
            musicGain.gain.value = value
            break
        case "speechGain":
            speechGain.gain.value = value
            break
        case "sfxGain":
            sfxGain.gain.value = value * 1.2
            break
    }
}, true)

// For voiceover ducking
const trackGain = audioContext.createGain()
trackGain.connect(musicGain)

/** @type {?AudioManager} */
export let MainTrack = null
/** @type {?AudioManager} */
export let VoiceoverTrack = null

const stopAudioTrackListeners = new Set()
export function addStopAudioTracksListener(listener) {
    stopAudioTrackListeners.add(listener)
}

export function stopAudioTracks() {
    for (const listener of stopAudioTrackListeners) listener()
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceoverTrack) { VoiceoverTrack.destroy() }

    trackGain.gain.cancelScheduledValues(audioContext.currentTime)
    trackGain.gain.value = 1
}

const VOICEOVER_DUCK_RAMP_DURATION = 0.8
const VOICEOVER_DUCK_RAMP_POSITION = 0.5
const VOICEOVER_DUCK_GAIN = 0.4

/** @typedef {AudioManager & {info: import("./radio.js").SegmentInfo}} SegmentAudio */
/** @typedef {AudioManager & {info: import("./types.js").VoiceoverInfo}} VoiceoverAudio */

/** @param {VoiceoverAudio} voiceover */
function playVoiceover(voiceover) {
    return new Promise((resolve) => {
        const offset = voiceover.info.offset
        const duration = voiceover.info.duration
        const endTime = offset + voiceover.info.duration

        if (MainTrack.currentTime > endTime) {
            resolve()
            return
        }

        VoiceoverTrack = voiceover
        VoiceoverTrack.onDestroy = () => { resolve() }
        
        if (MainTrack.currentTime < offset) {
            MainTrack.setTimeout(() => {
                if (MainTrack.currentTime > endTime) return
                VoiceoverTrack.play()
            }, offset)
        } else {
            VoiceoverTrack.play(MainTrack.currentTime - offset)
        }
        
        const duckRampDownStart = offset - (VOICEOVER_DUCK_RAMP_DURATION * VOICEOVER_DUCK_RAMP_POSITION)
        const duckRampUpStart = duration - (VOICEOVER_DUCK_RAMP_DURATION * (1 - VOICEOVER_DUCK_RAMP_POSITION))

        MainTrack.scheduleDuckingRamp(trackGain, duckRampDownStart, VOICEOVER_DUCK_RAMP_DURATION, 1, VOICEOVER_DUCK_GAIN)
        VoiceoverTrack.scheduleDuckingRamp(trackGain, duckRampUpStart, VOICEOVER_DUCK_RAMP_DURATION, VOICEOVER_DUCK_GAIN, 1)
    })
}

export class PreloadedSegment extends PlayableSegment {
    /** @param {PlayableSegment} segment  */
    constructor(segment) {
        super(segment.info, segment.startTimestamp)
        this.voiceovers = segment.voiceovers

        this.audioTrack = /** @type {SegmentAudio} */ (new AudioManager(segment.info, trackGain, true)) // Preload main track
        this.audioTrack.audio.load()
        
        /** @type {VoiceoverAudio[]} */
        this.voiceoverQueue = []
        for (const voiceover of segment.voiceovers || []) {
            const manager = new AudioManager(voiceover, speechGain, true) // Preload voiceovers
            manager.audio.load()
            this.voiceoverQueue.push(/** @type {any} */ (manager))
        }
    }

    async processVoiceoverQueue() {
        while (this.voiceoverQueue.length > 0) {
            const voiceover = this.voiceoverQueue.shift()
            await playVoiceover(voiceover)
        }
    }
}

/** @param {PlayableSegment} segment */
export function preloadSegment(segment) {
    return new PreloadedSegment(segment)
}

/** @param {PlayableSegment | PreloadedSegment} segment */
export function playSegment(segment) {
    /** @type {PreloadedSegment} */
    let preloadedSegment
    if (segment instanceof PlayableSegment) {
        preloadedSegment = new PreloadedSegment(segment)
    } else {
        preloadedSegment = segment
    }

    logs.startSegment(preloadedSegment)

    MainTrack = preloadedSegment.audioTrack
    MainTrack.playSynced(preloadedSegment.startTimestamp)
    MainTrack.audio.addEventListener("playing", () => {
        preloadedSegment.processVoiceoverQueue()
    }, { once: true })
}

export default { context: audioContext, masterGain, speechGain, sfxGain }
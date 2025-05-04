import { logs } from "./logging.js"
import { PlayableSegment } from "./radio.js"

/** @type {AudioContext} */
// @ts-ignore
let audioContext = new (window.AudioContext || window.webkitAudioContext)()

const AUDIO_PREPLAY_TIME = 0.8 // Execute onAudibleEnd and play audio 800ms early to reduce sync jumps
const AUDIO_DESYNC_THRESHOLD = 200 // Firefox fingerprint protection can reduce time precision to 100m so have to take that into consideration
const AUDIO_SYNC_INTERVAL_MS = 8000

const DUCK_RAMP_PREEMPT_TIME = 2 // AudioContext sometimes fails to work when scheduling value changes right away so some buffer time is required

/** @typedef {import("./types").AudioInfo} AudioInfo */
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
masterGain.gain.value = 0.6
masterGain.connect(audioContext.destination)

const musicGain = audioContext.createGain()
musicGain.gain.value = 0.8
musicGain.connect(masterGain)

const speechGain = audioContext.createGain()
speechGain.gain.value = 0.8
speechGain.connect(masterGain)

const sfxGain = audioContext.createGain()
sfxGain.gain.value = 0.6
sfxGain.connect(masterGain)

// For voiceover ducking
const trackGain = audioContext.createGain()
trackGain.connect(musicGain)

/** @type {?AudioManager} */
export let MainTrack = null
/** @type {?AudioManager} */
export let VoiceoverTrack = null

function randomPitchVariance(maxSemitones = 2) {
    const semitoneShift = (Math.random() * 2 - 1) * maxSemitones;
    return Math.pow(2, semitoneShift / 12);
}

function applyLowPassFilter(samples, cutoffFreq, sampleRate, poles = 1) {
    const RC = 1.0 / (cutoffFreq * 2 * Math.PI);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (RC + dt);

    for (let p = 0; p < poles; p++) {
        let previous = 0;
        for (let i = 0; i < samples.length; i++) {
            samples[i] = previous = previous + (alpha * (samples[i] - previous));
        }
    }
}

export const RetuneSound = {
    /** @type {AudioBuffer} */
    retunePositioned: null,
    /** @type {AudioManager} */
    staticLoop: null,
    /** @type {Array<AudioManager>} */
    blips: [],
    timeoutId: null,

    init() {
        this.retunePositioned = this.createRetunePositionedSound()
        this.staticLoop = new AudioManager({ path: "assets/sfx/RADIO_STATIC_LOOP.wav" }, sfxGain)
        this.staticLoop.audio.volume = 0.5
        this.staticLoop.audio.loop = true

        this.blips = []
        for (let i = 1; i <= 16; i++) {
            if (i === 3) continue
            const blipSound = new AudioManager({ path: `assets/sfx/BLIP_${i}.wav` }, sfxGain)
            blipSound.audio.volume = 0.38
            this.blips.push(blipSound)
        }
    },

    /** Synthesizes the audio buffer for the retune positioned sound, because it's a synth sound in the game */
    createRetunePositionedSound() {
        const duration = 0.2
        const sampleRate = audioContext.sampleRate
        const length = duration * sampleRate
        const buffer = audioContext.createBuffer(1, length, sampleRate)
        const data = buffer.getChannelData(0)
    
        const frequency = 2600
        const volume = 0.8
    
        for (let i = 0; i < length; i++) {
            const time = i / sampleRate
            const square = Math.sign(Math.sin(2 * Math.PI * frequency * time)) // Square wave
    
            // Exponential envelope
            let envelope = 1;
            if (time < 0.03) {
                envelope = Math.pow(time / 0.03, 1); // Attack
            } else if (time < 0.0555) {
                envelope = Math.pow(1 - ((time - 0.03) / 0.0255), 1); // Decay
            } else {
                envelope = 0;
            }
    
            data[i] = square * envelope * volume;
        }

        // Apply low-pass filtering to the buffer
        applyLowPassFilter(data, 7800, sampleRate, 3); // 7800 Hz cutoff, 3 poles
        return buffer
    },

    positioned() {
        const source = audioContext.createBufferSource()
        source.buffer = this.retunePositioned
        source.connect(sfxGain)
        source.start()
    },

    start() {
        this.staticLoop.play(Math.random() * 5)

        const blipLoop = () => {
            const chosenBlip = this.blips[Math.floor(Math.random() * this.blips.length)]
            chosenBlip.audio.playbackRate = randomPitchVariance()
            chosenBlip.play()
            this.timeoutId = setTimeout(blipLoop, 15 + (Math.random() * 500))
        }

        blipLoop()
    },

    stop() {
        if (this.staticLoop) { this.staticLoop.stop() }
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId)
            this.timeoutId = null
        }
    }
}
RetuneSound.init()

export function stopAudioTracks() {
    RetuneSound.stop()
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceoverTrack) { VoiceoverTrack.destroy() }

    trackGain.gain.cancelScheduledValues(audioContext.currentTime)
    trackGain.gain.value = 1
}

const VOICEOVER_DUCK_RAMP_DURATION = 0.8
const VOICEOVER_DUCK_RAMP_POSITION = 0.5
const VOICEOVER_DUCK_GAIN = 0.4

/** @typedef {AudioManager & {info: import("./radio").SegmentInfo}} SegmentAudio */
/** @typedef {AudioManager & {info: import("./types").VoiceoverInfo}} VoiceoverAudio */

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
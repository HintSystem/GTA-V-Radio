/** @type {AudioContext} */
// @ts-ignore
let audioContext = new (window.AudioContext || window.webkitAudioContext)()

/** @typedef {import("./types").AudioInfo} AudioInfo */
export class AudioManager {
    /** @type {HTMLAudioElement} */
    audio
    /** @type {MediaElementAudioSourceNode} */
    source
    /** @type {() => void} - Callback that executes when destroy() is called */
    onDestroy
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

    /** @param {number} startTime */
    play(startTime = 0) { this.audio.currentTime = startTime; this.audio.play() }

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

// for transitions
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

    start() {
        const source = audioContext.createBufferSource()
        source.buffer = this.retunePositioned
        source.connect(sfxGain)
        source.start()

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

let voiceoverQueue = []
export function stopAudioTracks() {
    voiceoverQueue = []

    RetuneSound.stop()
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceoverTrack) { VoiceoverTrack.destroy() }

    trackGain.gain.cancelScheduledValues(audioContext.currentTime)
    trackGain.gain.value = 1
}

/**
 * @param {import("./radio").SyncedSegment} segment 
 */
export function playSegment(segment) {
    MainTrack = new AudioManager(segment, trackGain, true)
    MainTrack.playSynced(segment.startTimestamp)

    for (const voiceover of segment.voiceovers || []) {
        voiceoverQueue.push(voiceover)
    }

    /** @param {import("./types").VoiceoverInfo} voiceover */
    async function playVoiceover(voiceover) {
        return new Promise((resolve) => {
            VoiceoverTrack = new AudioManager(voiceover, speechGain, true)
            VoiceoverTrack.onDestroy = () => { resolve() }

            VoiceoverTrack.audio.addEventListener("ended", () => {
                trackGain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 2)
            })

            MainTrack.setTimeout(() => {
                trackGain.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 2)
                VoiceoverTrack.play()
            }, voiceover.offset)
        })
    }

    async function processVoiceoverQueue() {
        while (voiceoverQueue.length > 0) {
            const voiceover = voiceoverQueue.shift()
            await playVoiceover(voiceover)
        }
    }
    processVoiceoverQueue()
}

export default { context: audioContext, masterGain, speechGain, sfxGain }
import audio, { AudioManager, addStopAudioTracksListener } from "./audio.js"

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

const RetuneSound = {
    /** @type {AudioBuffer} */
    retunePositioned: null,
    /** @type {AudioManager} */
    staticLoop: null,
    /** @type {Array<AudioManager>} */
    blips: [],
    timeoutId: null,

    init() {
        this.retunePositioned = this.createRetunePositionedSound()
        this.staticLoop = new AudioManager({ path: "assets/sfx/RADIO_STATIC_LOOP.wav" }, audio.sfxGain)
        this.staticLoop.audio.volume = 0.5
        this.staticLoop.audio.loop = true

        this.blips = []
        for (let i = 1; i <= 16; i++) {
            if (i === 3) continue
            const blipSound = new AudioManager({ path: `assets/sfx/BLIP_${i}.wav` }, audio.sfxGain)
            blipSound.audio.volume = 0.38
            this.blips.push(blipSound)
        }
    },

    /** Synthesizes the audio buffer for the retune positioned sound, because it's a synth sound in the game */
    createRetunePositionedSound() {
        const duration = 0.2
        const sampleRate = audio.context.sampleRate
        const length = duration * sampleRate
        const buffer = audio.context.createBuffer(1, length, sampleRate)
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
        const source = audio.context.createBufferSource()
        source.buffer = this.retunePositioned
        source.connect(audio.sfxGain)
        source.start()
    },

    start() {
        this.staticLoop.play(Math.random() * 5)

        clearTimeout(this.timeoutId)
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

addStopAudioTracksListener(() => {
    RetuneSound.stop()
})

export default {
    RETUNE: RetuneSound,
    MENU_TAB_SELECT: new AudioManager({ path: "assets/sfx/menu_tab_select.m4a" }, audio.sfxGain),
    MENU_SELECT: new AudioManager({ path: "assets/sfx/menu_select.m4a" }, audio.sfxGain),
    MENU_OPEN: new AudioManager({ path: "assets/sfx/menu_open.m4a" }, audio.sfxGain),
    PAUSE_MENU_OPEN: new AudioManager({ path: "assets/sfx/pause_menu_open.m4a" }, audio.sfxGain),
    PAUSE_MENU_CLOSE: new AudioManager({ path: "assets/sfx/pause_menu_close.m4a" }, audio.sfxGain)
}
import stationManager, { station } from "../station-manager.js"
import { UIComponent } from "./base-components.js"

import { Music } from "./icons.js"

export default class RadioDisplay extends UIComponent {
    /** @private @type {boolean} */
    spectrumEnabled = false

    /**
     * @param {HTMLElement} containerEl
     * @param {AudioContext} audioContext 
     */
    constructor(containerEl, audioContext) {
        super()
        this.element = containerEl
        this.element.classList.add("radioDisplay")
        Music.insertVariant(this.element)

        this.stationTitle = document.createElement("div")
        this.stationTitle.className = "station"
        this.trackLabel = document.createElement("div")
        this.trackLabel.className = "track"
        this.artistLabel = document.createElement("div")
        this.artistLabel.className = "artist"

        this.element.appendChild(this.stationTitle)
        this.element.appendChild(this.trackLabel)
        this.element.appendChild(this.artistLabel)
        
        this.canvas = document.createElement("canvas")
        this.canvasCtx = this.canvas.getContext("2d")
        this.canvas.style = ""
        
        this.analyser = audioContext.createAnalyser()
        this.analyser.fftSize = 128
        this.analyser.smoothingTimeConstant = 0.7
        
        this.spectrum = new Float32Array(this.analyser.frequencyBinCount)
        this.maxFreq = audioContext.sampleRate / 2
        
        this.updateSpectrum = this.updateSpectrum.bind(this)
        this.onStationChanged = this.onStationChanged.bind(this)
        this.onTrackMarkerChanged = this.onTrackMarkerChanged.bind(this)

        stationManager.on("stationChanged", this.onStationChanged)
        stationManager.on("trackMarkerChanged", this.onTrackMarkerChanged)

        this.element.appendChild(this.canvas)
    }

    /** @param {boolean} enabled  */
    setSpectrumEnabled(enabled) {
        this.spectrumEnabled = enabled
        if (enabled) this.updateSpectrum()
    }

    /** @private */
    onStationChanged() {
        const stationText = station != null ? station.meta.info.title : "Radio Off"
        this.stationTitle.innerText = stationText
    }

    /**
     * @private
     * @param {import("../types.js").TrackMarker} marker
     */
    onTrackMarkerChanged(marker) {
        this.trackLabel.innerText = marker?.title || ""
        this.artistLabel.innerText = marker?.artist || ""
    }

    /** @private */
    updateSpectrum() {
        const barWidth = 12
        const barGap = 4
        const barCount = Math.min(16, this.canvas.width / (barWidth + barGap))

        const startHz = 400
        const endHz = 17000
        const base = Math.pow(endHz / startHz, 1 / barCount)

        const segmentHeight = 3.5
        const segmentGap = 3.5
        const maxSegments = Math.floor(this.canvas.height / (segmentHeight + segmentGap))

        this.analyser.getFloatFrequencyData(this.spectrum)
        
        let x = (this.canvas.width - ((barWidth + barGap) * barCount)) / 2
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height)

        const rootStyles = getComputedStyle(document.documentElement)
        const color = rootStyles.getPropertyValue('--ui-secondary-color').trim()

        this.canvasCtx.fillStyle = `rgb(${color})`

        for (let i = 0; i < barCount; i++) {
            const fLow = startHz * Math.pow(base, i)
            const fHigh = startHz * Math.pow(base, i + 1)

            //console.log(`${i} - ${fLow} to ${fHigh}`)

            const binLow = Math.floor(fLow / this.maxFreq * this.analyser.frequencyBinCount)
            const binHigh = Math.min(this.analyser.frequencyBinCount - 1,
                                    Math.ceil(fHigh / this.maxFreq * this.analyser.frequencyBinCount))

            // Average dB value in the range
            let sum = 0
            for (let j = binLow; j <= binHigh; j++) { sum += this.spectrum[j] }
            const avgDb = sum / (binHigh - binLow + 1)

            // Normalize from dB (-90 to -30) → 0 to 1
            let value = (avgDb + 90) / 60
            value = Math.max(0, Math.min(1, value))

            function perceptualWeight(frequencyHz) {
                const low = 500
                const mid = 2000
                const midWidth = 2000

                const lowRolloff = 1 / (1 + Math.exp(-0.002 * (frequencyHz - low)))
                const midBoost = Math.exp(-Math.pow((frequencyHz - mid) / midWidth, 2))

                return lowRolloff * (0.8 + 0.2 * midBoost)
            }
            const perceptual = perceptualWeight((fLow + fHigh) / 2)
            const strength = Math.pow(value * perceptual, 1.5)

            const activeSegments = Math.floor(strength * maxSegments)

            for (let s = 0; s < activeSegments; s++) {
                const y = this.canvas.height - (s + 1) * (segmentHeight + segmentGap)
                this.canvasCtx.fillRect(x, y, barWidth, segmentHeight)
            }

            x += barWidth + barGap
        }

        if (this.spectrumEnabled) requestAnimationFrame(this.updateSpectrum)
    }

    /** @private */
    logBinFrequencyRanges() {
        const freqIncrement = this.maxFreq / this.analyser.frequencyBinCount
        for (let bin = 0; bin < this.analyser.frequencyBinCount; bin++) {
            const startFreq = bin * freqIncrement
            const endFreq = (bin + 1) * freqIncrement
            console.log(`Bin ${bin}: ${startFreq.toFixed(1)} Hz – ${endFreq.toFixed(1)} Hz`)
        }
    }

    destroy() {
        super.destroy()

        stationManager.off("stationChanged", this.onStationChanged)

        this.spectrumEnabled = false
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
}
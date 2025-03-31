import { radioMeta } from "./constants.js"
import { StationMeta } from "./radio.js"

/** @type {RadioStation | undefined} */
let station = undefined

/**
 * @typedef {Object} audioInfo
 * @property {string} path - Path to the audio file
 * @property {number?} duration - Total duration of audio
 * @property {number?} audibleDuration - Audible duration of audio
 */

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
class AudioManager {
    /**
     * @type {HTMLAudioElement}
     */
    audio
    /**
     * @type {MediaElementAudioSourceNode}
     */
    source

    /**
     * @param {audioInfo | HTMLAudioElement} audioInfo
     * @param {AudioNode?} connection - node to connect to
     * @param {boolean} autoDestroy - when set to True, destroys the audio when finished
     */
    constructor(audioInfo, connection = null, autoDestroy = false) {
        if (audioInfo instanceof HTMLAudioElement) {
            this.info = undefined
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

    play() { this.audio.currentTime = 0; this.audio.play() }

    pause() { this.audio.pause() }

    stop() { this.audio.pause(); this.audio.currentTime = 0 }

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

/** @type {AudioManager} */
let MainTrack = undefined
/** @type {AudioManager} */
let VoiceOverTrack = undefined

function playSegment(segment, time = undefined) {
    MainTrack = new AudioManager(segment, trackGain)
    if (time) { MainTrack.audio.currentTime = time }
    MainTrack.resume()

    if (segment.voiceOver) {
        VoiceOverTrack = new AudioManager(segment.voiceOver, masterGain)

        VoiceOverTrack.audio.addEventListener("ended", () => {
            trackGain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 2)
            VoiceOverTrack.destroy()
        })
        MainTrack.setTimeout(() => {
            trackGain.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 2)
            VoiceOverTrack.play()
        }, 5)
    }
}

function onSegmentEnd() {
    playSegment(station.nextSegment(true))
    MainTrack.onAudibleEnd(onSegmentEnd)
}

const staticAudio = new AudioManager({ path: "assets/sfx/RADIO_STATIC_LOOP.wav" }, masterGain)

function stopPlayingTracks() {
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceOverTrack) { VoiceOverTrack.destroy() }
}

function syncToStation(newStation) {
    stopPlayingTracks()

    station = newStation
    audioContext.resume()

    staticAudio.play()

    const syncedSegment = station.getSyncedSegment()
    playSegment(syncedSegment[0], syncedSegment[1])
    console.log(syncedSegment)

    MainTrack.audio.addEventListener("canplay", () => { staticAudio.stop() })

    MainTrack.onAudibleEnd(onSegmentEnd)
}

function newStationButton() {
    const label = document.createElement("label")
    const input = document.createElement("input")
    input.hidden = true
    input.type = "radio"
    input.name = "selected_station"
    const iconBorder = document.createElement("span")
    const icon = document.createElement("img")
    icon.alt = "loading"

    label.appendChild(input)
    label.appendChild(iconBorder)

    return {
        label,
        input,
        icon,
        loadIcon: (iconSrc, iconAlt) => {
            icon.alt = iconAlt
            icon.src = iconSrc
            iconBorder.appendChild(icon)
        }
    }
}

radioMeta.then(function createRadioStationButtons (meta) {
    const noStationBtn = newStationButton()
    noStationBtn.input.checked = true
    noStationBtn.loadIcon("assets/images/no_radio.svg", "No radio")
    noStationBtn.label.addEventListener("click", stopPlayingTracks)

    const stationList = document.getElementById("stationList")

    for (let i = 0; i < meta.stations.length; i++) {
        const stationMeta = new StationMeta(meta.stations[i].path)
        const stationBtn = newStationButton()

        stationBtn.input.addEventListener("click", () => {
            console.log("station")
            stationMeta.createStation().then(syncToStation)
        })
        
        stationList.appendChild(stationBtn.label)
        stationMeta.loadMeta()
            .then((meta) => {
                stationBtn.input.ariaLabel = meta.info.title
                stationBtn.loadIcon(stationMeta.getAbsolutePath(meta.info.icon.color), meta.info.title)
            })
    }

    stationList.appendChild(noStationBtn.label)
})
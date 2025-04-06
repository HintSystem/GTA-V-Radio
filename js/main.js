import { radioMeta, pageIcon } from "./constants.js"
import { StationMeta, RadioStation } from "./radio.js"

/** @type {?RadioStation} */
let station = null
/** @type {?number} */
let stationIndex = null

/** @type {StationMeta[]} */
let stationList = []

/**
 * @typedef {Object} audioInfo
 * @property {string} path - Path to the audio file
 * @property {number?} duration - Total duration of audio
 * @property {number?} audibleDuration - Audible duration of audio
 */

let audioContext = new (window.AudioContext || window.webkitAudioContext)()
class AudioManager {
    /** @type {HTMLAudioElement} */
    audio
    /** @type {MediaElementAudioSourceNode} */
    source

    /**
     * @param {audioInfo | HTMLAudioElement} audioInfo
     * @param {AudioNode?} connection - node to connect to
     * @param {boolean} autoDestroy - when set to True, destroys the audio when finished
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

/** @type {?AudioManager} */
let MainTrack = null
/** @type {?AudioManager} */
let VoiceOverTrack = null

function stopPlayingTracks() {
    if (MainTrack) { MainTrack.destroy() }
    if (VoiceOverTrack) { VoiceOverTrack.destroy() }
}

function playSegment(segment, time = null) {
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

const defaultTitle = document.title
function resetRadioMeta() {
    document.title = defaultTitle
    pageIcon.reset()

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: defaultTitle, artwork: [{ src: pageIcon.element.href }] })
    }
}

function updateRadioMeta() {
    const title = station.meta.info.title

    document.title = title
    pageIcon.element.href = station.getPrefferedIcon("color")
    pageIcon.element.type = "image/svg+xml"
    if ('mediaSession' in navigator) {
        let artwork = []
        const coverArt = station.getIcon("cover")
        if (coverArt) { artwork = [ { src: coverArt, sizes: "512x512", type: "image/png" } ] }
        
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: station.meta.info.dj, artwork })
    }
}

function mod(n, m) { return ((n % m) + m) % m }

function getNextStation() {
    if (stationIndex === null) { return 0 }
    return mod(stationIndex + 1, stationList.length)
}

function getPrevStation() {
    if (stationIndex === null) { return stationList.length - 1 }
    return mod(stationIndex - 1, stationList.length)
}

/** @type {Object<string, (() => void)[]>} */
let stationListeners = {}

const staticAudio = new AudioManager({ path: "assets/sfx/RADIO_STATIC_LOOP.wav" }, masterGain)

/** Syncs audio tracks to currently loaded radio station */
function syncToStation() {
    stopPlayingTracks()
    audioContext.resume()
    
    staticAudio.play()
    
    const syncedSegment = station.getSyncedSegment()
    playSegment(syncedSegment[0], syncedSegment[1])
    console.log(syncedSegment)
    
    MainTrack.audio.addEventListener("canplay", () => { staticAudio.stop() })
    
    MainTrack.onAudibleEnd(onSegmentEnd)
}

/**
 * Loads, sets and syncs audio to a new station
 * @param {number} index - Index of the station (from stationList)
 */
async function setStation(index) {
    stationIndex = index

    const callbacks = stationListeners[index] || []
    callbacks.forEach((callback) => { callback() })

    station = await stationList[index].createStation()
    updateRadioMeta()
    syncToStation()
}

function stopStation() {
    stopPlayingTracks()
    resetRadioMeta()

    const callbacks = stationListeners[null] || []
    callbacks.forEach((callback) => { console.log(callback); callback() })
    stationIndex = null
}

function clearStationList() {
    stationListeners = {}
    stationList = []
    stationIndex = null
}

/**
 * Executes callback when user changes station (before station has finished loading)
 * @param {string} index - Index of the station (from stationList)
 * @param {() => void} callback
 */
function addStationListener(index, callback) {
    if (!(index in stationListeners)) { stationListeners[index] = [] }
    const list = stationListeners[index]
    if (!list.includes(callback)) { list.push(callback) }
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler("play", () => { syncToStation() })
    navigator.mediaSession.setActionHandler("pause", stopPlayingTracks)
    navigator.mediaSession.setActionHandler("nexttrack", () => { setStation(getNextStation()) })
    navigator.mediaSession.setActionHandler("previoustrack", () => { setStation(getPrevStation()) })

    navigator.mediaSession.setPositionState({ duration: 0, position: 0, playbackRate: 1 })
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
    clearStationList()

    const noStationBtn = newStationButton()
    noStationBtn.loadIcon("assets/images/no_radio.svg", "No radio")
    noStationBtn.input.addEventListener("click", stopStation)

    addStationListener(null, () => noStationBtn.input.checked = true)

    const stationListUI = document.getElementById("stationList")

    for (let i = 0; i < meta.stations.length; i++) {
        const stationBtn = newStationButton()
        const stationMeta = new StationMeta(meta.stations[i].path)

        stationList.push(stationMeta)
        stationBtn.input.addEventListener("click", () => { setStation(i) })
        addStationListener(i, () => { stationBtn.input.checked = true })
        
        stationListUI.appendChild(stationBtn.label)
        stationMeta.loadMeta().then((meta) => {
            stationBtn.loadIcon(stationMeta.getPrefferedIcon("color"), meta.info.title)
        })
    }

    stationListUI.appendChild(noStationBtn.label)
})
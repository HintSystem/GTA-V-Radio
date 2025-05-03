import { logs } from "./logging.js"
import { radioMetaPromise, pageIcon } from "./constants.js"
import { StationMeta, RadioStation } from "./radio.js"
import audio, { MainTrack, preloadSegment, playSegment, stopAudioTracks, RetuneSound } from "./audio.js"

const RETUNE_DELAY_MS = 100
const SEGMENT_PRELOAD_TIME = 10

/** @type {?RadioStation} */
export let station = null
/** @type {?number} */
export let stationIndex = null

/** @type {StationMeta[]} */
export let stationList = []

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

/** @type {Object<string, Array<(() => void)>>} */
let stationListeners = {}

function stopRetuneOnPlay() {
    MainTrack.audio.addEventListener("canplay", () => {
        RetuneSound.stop()
        retuneOnBuffer()
    }, { once: true })
}

function retuneOnBuffer() {
    MainTrack.audio.addEventListener("waiting", () => {
        setTimeout(() => {
            if (MainTrack.isBuffering) RetuneSound.start()
        }, RETUNE_DELAY_MS)
        stopRetuneOnPlay()
    }, { once: true })
}

/** Plays a segment and gets ready to load the next */
function playStationSegment(playableSegment) {
    playSegment(playableSegment)
    logs.logNextSegment(station.clone().nextSegment())

    const offset = Math.max(MainTrack.currentTime + 0.1, MainTrack.info.duration - SEGMENT_PRELOAD_TIME)
    MainTrack.setTimeout(preloadNextSegment, offset, true)
}

function preloadNextSegment() {
    const preloadedSegment = preloadSegment(station.nextSegment())
    logs.logPreloadingSegment(preloadedSegment)

    MainTrack.onAudibleEnd(() => {
        playStationSegment(preloadedSegment)
        retuneOnBuffer()
    })
}

/** Syncs audio tracks to currently loaded radio station */
function syncToStation() {
    stopAudioTracks()
    audio.context.resume()
    
    RetuneSound.positioned()
    RetuneSound.start()
    
    const time = performance.now()
    const syncedSegment = station.getSyncedSegment()

    console.groupEnd()
    logs.logStationSync(performance.now() - time, station.meta.info.title)
    
    playStationSegment(syncedSegment)
    stopRetuneOnPlay()
}

/**
 * Loads, sets and syncs audio to a new station
 * @param {number} index - Index of the station (from stationList)
 */
async function setStation(index) {
    stationIndex = index

    const callbacks = stationListeners[index] || []
    callbacks.forEach((callback) => { callback() })

    if (index === null) {
        resetRadioMeta()
    } else {
        station = await stationList[index].createStation()
        syncToStation()
        updateRadioMeta()
    }
}

function stopStation() {
    stopAudioTracks()
    resetRadioMeta()

    const callbacks = stationListeners["null"] || []
    callbacks.forEach((callback) => { callback() })
    stationIndex = null
}

function clearStationList() {
    stationListeners = {}
    stationList = []
    stationIndex = null
}

/**
 * Executes callback when user changes station (before station has finished loading)
 * @param {number|null} index - Index of the station (from stationList)
 * @param {() => void} callback
 */
function addStationListener(index, callback) {
    if (!(index in stationListeners)) { stationListeners[index] = [] }
    const list = stationListeners[index]
    if (!list.includes(callback)) { list.push(callback) }
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler("play", () => { syncToStation() })
    navigator.mediaSession.setActionHandler("pause", stopAudioTracks)
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

radioMetaPromise.then(function createRadioStationButtons (meta) {
    clearStationList()

    const noStationBtn = newStationButton()
    noStationBtn.loadIcon("assets/images/no_radio.svg", "No radio")
    noStationBtn.input.addEventListener("click", stopStation)

    addStationListener(null, () => noStationBtn.input.checked = true)
    setStation(null)

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
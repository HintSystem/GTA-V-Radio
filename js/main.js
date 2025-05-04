import { logs } from "./logging.js"
import { radioMetaPromise, pageIcon } from "./constants.js"
import { StationMeta, RadioStation, PlayableSegment } from "./radio.js"
import audio, { MainTrack, preloadSegment, playSegment, stopAudioTracks, RetuneSound } from "./audio.js"

const RETUNE_DELAY_MS = 100
const SEGMENT_PRELOAD_TIME = 15

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

/** @returns {MediaMetadataInit} */
function getStationMediaMeta() {
    const coverArt = station.getIcon("cover")
    const artwork = coverArt ? [ { src: coverArt, sizes: "512x512", type: "image/png" } ] : []

    return { title: station.meta.info.title, artist: station.meta.info.dj, artwork }
}

/** @param {MediaMetadataInit} meta */
function setMediaMeta(meta = null) {
    if (!meta) meta = getStationMediaMeta()
    
    document.title = meta.title
    pageIcon.element.href = station.getPrefferedIcon("color")
    pageIcon.element.type = "image/svg+xml"

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata(meta)
    }
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler("play", syncToStation)
    navigator.mediaSession.setActionHandler("pause", stopAudioTracks)
    navigator.mediaSession.setActionHandler("nexttrack", () => { setStation(getNextStation()) })
    navigator.mediaSession.setActionHandler("previoustrack", () => { setStation(getPrevStation()) })

    navigator.mediaSession.setPositionState({ duration: 0, position: 0, playbackRate: 1 })
}

/** @param {import("./types.js").TrackMarker} trackMarker  */
function setTrackTitle(trackMarker) {
    const stationMeta = getStationMediaMeta()

    if (trackMarker.title || trackMarker.artist) {
        if (trackMarker.title && trackMarker.artist) {
            stationMeta.artist = `${trackMarker.title} - ${trackMarker.artist}`;
        } else {
            stationMeta.artist = trackMarker.title || trackMarker.artist;
        }
    }

    setMediaMeta(stationMeta)
}

let retuneTimeout = null
function stopRetuneOnPlay() {
    MainTrack.audio.addEventListener("canplay", () => {
        clearTimeout(retuneTimeout)
        RetuneSound.stop()
        retuneOnBuffer()
    }, { once: true })
}

function retuneOnBuffer() {
    MainTrack.audio.addEventListener("waiting", () => {
        retuneTimeout = setTimeout(() => {
            if (MainTrack.isBuffering) RetuneSound.start()
        }, RETUNE_DELAY_MS)
        stopRetuneOnPlay()
    }, { once: true })
}

/** @param {PlayableSegment} segment */
function queueTitleChangeEvents(segment) {
    const trackMarkers = segment.info?.markers?.track
    if (!trackMarkers || trackMarkers.length == 0) { setMediaMeta(); return }

    const { index: lastMarker } = segment.getActiveTrackMarker()

    for (let i = lastMarker; i < trackMarkers.length; i++) {
        const marker = trackMarkers[i]
        MainTrack.setTimeout(() => {
            setTrackTitle(marker)
            logs.logTitleChange(marker)
        }, marker.offset / 1000, true)
    }
}

/**
 * Plays a segment and gets ready to load the next
 * @param {PlayableSegment} segment 
 */
function playStationSegment(segment) {
    playSegment(segment)
    queueTitleChangeEvents(segment)
    logs.logNextSegment(station.clone().nextSegment())

    MainTrack.setTimeout(preloadNextSegment, MainTrack.info.duration - SEGMENT_PRELOAD_TIME, true)
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
    setMediaMeta()
    
    RetuneSound.positioned()
    RetuneSound.start()
    
    const time = performance.now()
    const syncedSegment = station.getSyncedSegment()

    console.groupEnd()
    logs.logStationSync(performance.now() - time, station.meta.info.title)
    
    playStationSegment(syncedSegment)
    stopRetuneOnPlay()
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

/**
 * Loads, sets and syncs audio to a new station
 * @param {number} index - Index of the station (from stationList)
 */
async function setStation(index) {
    stationIndex = index

    const callbacks = stationListeners[index] || []
    callbacks.forEach((callback) => { callback() })

    if (index === null) {
        stopAudioTracks()
        resetRadioMeta()
    } else {
        station = await stationList[index].createStation()
        syncToStation()
    }
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
    noStationBtn.input.addEventListener("click", () => setStation(null))

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
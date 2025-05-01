import { radioMeta, pageIcon } from "./constants.js"
import { StationMeta, RadioStation } from "./radio.js"
import audio, { MainTrack, playSegment, stopAudioTracks, RetuneSound } from "./audio.js"

/** @type {?RadioStation} */
let station = null
/** @type {?number} */
let stationIndex = null

/** @type {StationMeta[]} */
let stationList = []

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

function attachRetuneListener() {
    MainTrack.audio.addEventListener("waiting", () => {
        RetuneSound.start()
        MainTrack.audio.addEventListener("canplay", () => {
            RetuneSound.stop()
            attachRetuneListener()
        }, { once: true })
    }, { once: true })
}

function onSegmentEnd() {
    playSegment(station.nextSegment())
    attachRetuneListener()
    MainTrack.onAudibleEnd(onSegmentEnd)
}

/** Syncs audio tracks to currently loaded radio station */
function syncToStation() {
    stopAudioTracks()
    audio.context.resume()
    
    RetuneSound.positioned()
    
    const time = performance.now()
    const syncedSegment = station.getSyncedSegment()
    console.log(`Syncing to station took: ${performance.now() - time}ms`)
    console.log(syncedSegment)
    
    playSegment(syncedSegment)
    attachRetuneListener()
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

radioMeta.then(function createRadioStationButtons (meta) {
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
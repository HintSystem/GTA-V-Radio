import { station } from "../station-manager.js"
import { MainTrack, playSegment, stopAudioTracks } from "../audio.js"

// @ts-ignore
window.radio = {
    nextSegment(count = 1, offset_ms = 0) {
        stopAudioTracks()

        let segment
        for (let i = 0; i < count; i++) {
            segment = station.nextSegment()
        }
        
        let time = Date.now()
        if (offset_ms) { time -= offset_ms }

        segment.startTimestamp = time
        playSegment(segment)
    },

    setSegmentTime(offset_s) {
        MainTrack.playSynced(Date.now() - (offset_s * 1000))
    }
}
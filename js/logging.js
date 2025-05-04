import { getCategoryId } from "./radio.js"

/** @typedef {import("./radio").PlayableSegment} PlayableSegment */
/** @typedef {import("./audio").PreloadedSegment} PreloadedSegment */

const SHARED_STYLE = 'padding: 0 5px; border-radius: 2px;'

class RadioLogger {

    /** @param {PlayableSegment} playableSegment  */
    startSegment(playableSegment) {
        console.groupEnd()

        const duration = playableSegment.info.duration.toFixed(1)
        const progress = ((Date.now() - playableSegment.startTimestamp) / 1000).toFixed(1)
        console.group(`%c𝅘𝅥𝅮 Now playing: ${playableSegment.getTitle()} (${progress}s/${duration}s)`,
        'font-weight: bold; font-size: 14px; color: white; background: #4A5568; padding: 4px 8px; border-radius: 4px;');
        
        const timestamp = new Date(playableSegment.startTimestamp);
        console.log(
            `%c⏱️ Timestamp: ${timestamp.toLocaleTimeString()}`,
            'color:rgb(160, 175, 199);'
        );
        this.logSegment(playableSegment)
    }

    /**
     * @param {number} timeMs
     * @param {string} stationName
     */
    logStationSync(timeMs, stationName) {
        console.log(
            `%c🔄 Syncing to '${stationName}' took ${timeMs}ms`,
            'color: #3182CE; background: #EBF8FF;' + SHARED_STYLE
        );
    }

    /** @param {PlayableSegment} playableSegment */
    logSegment(playableSegment) {
        console.groupCollapsed('%c📋 Segment Details', 'color: #2C7A7B; background: #E6FFFA;' + SHARED_STYLE);
        
        console.log(playableSegment)
        
        if (playableSegment.voiceovers && playableSegment.voiceovers.length > 0) {
            console.group('%c🎙️ Voiceovers', 'color: #805AD5; background: #FAF5FF;' + SHARED_STYLE);
            playableSegment.voiceovers.forEach((vo, i) => {
                console.log(`${i + 1}. (${vo.offset}s) ${vo.path}`);
            });
            console.groupEnd();
        }
        
        console.groupEnd();
    }

    /** @param {PreloadedSegment} preloadedSegment */
    logPreloadingSegment(preloadedSegment) {
        const title = preloadedSegment.getTitle()
        const begins = (Math.abs(Date.now() - preloadedSegment.startTimestamp) / 1000).toFixed(1)
        console.log(
            `%c📦 Preloading segment: ${title} (begins in ${begins}s)`,
            'color: #6B46C1; background: #E9D8FD;' + SHARED_STYLE
        );
    }

    /** @param {import("./types.js").TrackMarker} marker  */
    logTitleChange(marker) {
        console.log(
            `%c🎵 Track title changed: title - "${marker.title}" | artist - "${marker.artist}"`,
            'color: #1A202C; background: #F7FAFC; border-left: 4px solid #3182CE; padding: 0 10px;'
        );
    }

    /** @param {PlayableSegment} playableSegment */
    logNextSegment(playableSegment) {
        console.log(
            `%c⏭️ Playing next: ${getCategoryId(playableSegment.info.category).toUpperCase()} - ${playableSegment.getTitle()}`,
            'color: #6B46C1; background: #E9D8FD;' + SHARED_STYLE
        );
    }

    /**
     * @param {number} jumpMs - Sync jump time in milliseconds 
     */
    logJump(jumpMs) {
        console.log(
            `%c⤵️ Jump: ${jumpMs.toFixed(0)}ms`,
            'color: #DD6B20; background: #FEEBC8;' + SHARED_STYLE
        );
    }

    /**
     * @param {number} desyncMs - Desync amount in milliseconds
     * @param {number} time - Time in seconds
     */
    logDesync(desyncMs, time) {
        if (Math.abs(desyncMs) < 50) { return }
        console.log(
            `%c⚠️ Audio time desync: ${desyncMs.toFixed(0)}ms at ${time.toFixed(0)}s`,
            'color: #C53030; background: #FED7D7; font-weight: bold;' + SHARED_STYLE
        );
    }
}

export const logs = new RadioLogger()
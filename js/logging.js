import { getCategoryId } from "./radio.js"

/** @typedef {import("./radio").PlayableSegment} PlayableSegment */

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
            'color:rgb(160, 175, 199); font-style: italic;'
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
            'color: #3182CE; background: #EBF8FF; padding: 2px 4px; border-radius: 2px;'
        );
    }

    /** @param {PlayableSegment} playableSegment */
    logSegment(playableSegment) {
        console.groupCollapsed('%c📋 Segment Details', 'color: #2C7A7B; background: #E6FFFA; padding: 2px 4px; border-radius: 2px;');
        
        console.log(playableSegment)
        
        if (playableSegment.voiceovers && playableSegment.voiceovers.length > 0) {
            console.group('%c🎙️ Voiceovers', 'color: #805AD5; background: #FAF5FF; padding: 2px 4px; border-radius: 2px;');
            playableSegment.voiceovers.forEach((vo, i) => {
                console.log(`${i + 1}. (${vo.offset}s) ${vo.path}`);
            });
            console.groupEnd();
        }
        
        console.groupEnd();
    }

    /** @param {PlayableSegment} playableSegment */
    logNextSegment(playableSegment) {
        console.log(
            `%c⏭️ Playing next: ${getCategoryId(playableSegment.info.category).toUpperCase()} - ${playableSegment.getTitle()}`,
            'color:rgb(102, 48, 230);; background:rgb(226, 214, 255); padding: 2px 4px; border-radius: 2px;'
        );
    }

    /**
     * @param {number} jumpMs - Sync jump time in milliseconds 
     */
    logJump(jumpMs) {
        console.log(
            `%c⤵️ Jump: ${jumpMs.toFixed(0)}ms`,
            'color: #DD6B20; background: #FEEBC8; padding: 2px 4px; border-radius: 2px;'
        );
    }

    /**
     * @param {number} desyncMs - Desync amount in milliseconds
     * @param {number} time - Time in seconds
     */
    logDesync(desyncMs, time) {
        if (desyncMs < 50) { return }
        console.log(
            `%c⚠️ Audio time desync: ${desyncMs.toFixed(0)}ms at ${time.toFixed(0)}s`,
            'color: #C53030; background: #FED7D7; padding: 2px 4px; border-radius: 2px; font-weight: bold;'
        );
    }
}

export const logs = new RadioLogger()
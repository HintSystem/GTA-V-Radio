import type { AudioInfo } from "./audio"

export interface RelativeAudioInfo extends AudioInfo {
  /** Audio path relative to station path */
  path: string
}

export interface SegmentInfo extends RelativeAudioInfo {
    voiceovers: RelativeAudioInfo[]
}

export interface SyncedSegment extends SegmentInfo {
    /** Absolute audio path */
    path: string
    /** UTC time (in milliseconds) representing when the segment started playing */
    startTimestamp: number
    /** Chosen voiceover, if any */
    voiceOver?: RelativeAudioInfo
}
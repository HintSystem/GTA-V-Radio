import { AudioInfo } from "./audio"

export interface AudioInfo {
  /** Absolute audio path */
  path: string
  /** In seconds */
  duration: number
  /** In seconds */
  audibleDuration?: number
}

export interface RelativeAudioInfo extends AudioInfo {
  /** Audio path relative to station path */
  path: string
}

export interface SegmentInfo extends RelativeAudioInfo {
    voiceovers?: RelativeAudioInfo[]
    [key: string]: any
}

export interface SyncedSegment extends AudioInfo {
    /** UTC time (in milliseconds) representing when the segment started playing */
    startTimestamp: number
    /** Chosen voiceover, if any */
    voiceOver?: AudioInfo
    isTrack?: boolean
}

export type StationType = "dynamic" | "talkshow" | "static"
export type IconType = "color" | "monochrome" | "full" | "cover"
export interface StationMetadata {
  /** If not present, assume "dynamic" */
  type?: StationType
  info: {
    title: string,
    genre: string,
    dj: string,
    icon: {
      color?: string,
      monochrome?: string,
      full?: string
      /** Obligatory icon that is displayed as artwork for mediaSession */
      cover: string
    }
  }

  fileGroups: {
    track: SegmentInfo[]
    general?: RelativeAudioInfo[]
    id?: RelativeAudioInfo[]
    mono_solo?: RelativeAudioInfo[]
    time_evening?: RelativeAudioInfo[]
    time_morning?: RelativeAudioInfo[]
    to_adverts: RelativeAudioInfo[]
    to_news: RelativeAudioInfo[]
  }
}

export interface RadioMetadata {
  common: {
    fileGroups: Object[]
  }
  stations: {
    /** Relative path to the folder of a station */
    path: string
  }[]
}
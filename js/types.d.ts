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
  category: number
  [key: string]: any
}

export interface VoiceoverInfo extends AudioInfo {
  /** Time (in seconds) relative to track when this speech should start playing */
  offset: number
}

export interface SyncedSegment extends AudioInfo {
  /** UTC time (in milliseconds) representing when the segment started playing */
  startTimestamp: number
  /** Chosen speeches for track, if any */
  voiceovers?: VoiceoverInfo[]
  category: number
}

export type StationType = "dynamic" | "talkshow" | "static"
export type IconType = "color" | "monochrome" | "full" | "cover"

export interface AudioMarker {
  /** Time (in ms) this marker is positioned at in the track */
  offset: number
}
export interface TrackMarker extends AudioMarker {
  title?: string
  artist?: string
}

export interface DJMarker extends AudioMarker {
  value: "intro_start" | "intro_end" | "outro_start" | "outro_end"
}

export interface StationMetadata {
  /** If not present, assume "dynamic" */
  id: string
  type?: StationType
  info: {
    title: string
    genre: string
    dj: string
    icon: {
      color?: string
      monochrome?: string
      full?: string
      /** Obligatory icon that is displayed as artwork for media sessions */
      cover: string
    }
  }

  common: {
    adverts?: string[]
  }

  fileGroups: {
    track: Array<SegmentInfo & {
      attachments?: { intro?: VoiceoverInfo[] }
      markers?: {
        track?: TrackMarker[]
        dj?: DJMarker[]
      }
    }>
    id?: SegmentInfo[]
    mono_solo?: SegmentInfo[]
    general?: RelativeAudioInfo[]
    time_evening?: RelativeAudioInfo[]
    time_morning?: RelativeAudioInfo[]
    to_adverts?: RelativeAudioInfo[]
    to_news?: RelativeAudioInfo[]
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
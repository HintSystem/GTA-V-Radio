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

export interface VoiceoverInfo extends AudioInfo {
  /** Time (in seconds) relative to track when this speech should start playing */
  offset: number
}

export interface SegmentInfo extends RelativeAudioInfo {
  attachments?: { intro?: VoiceoverInfo[] }
  markers?: {
    track?: TrackMarker[]
    dj?: DJMarker[]
  }
  category: number
}

export type StationType = "dynamic" | "talkshow" | "static"
export type IconType = "color" | "monochrome" | "full" | "cover"

export interface AudioMarker {
  /** Marker position in track (in ms) */
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
    track: SegmentInfo[]
    adverts?: SegmentInfo[]
    id?: RelativeAudioInfo[]
    mono_solo?: RelativeAudioInfo[]
    general?: RelativeAudioInfo[]
    time_evening?: RelativeAudioInfo[]
    time_morning?: RelativeAudioInfo[]
    to_adverts?: RelativeAudioInfo[]
    to_news?: RelativeAudioInfo[]
  }
}

export interface RadioMetadata {
  common: {
    [key: string]: SegmentInfo[]
  }
  stations: {
    /** Relative path to the folder of a station */
    path: string
  }[]
}
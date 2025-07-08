const MAX_DECIMAL_PLACES = 5

/** @typedef {string | number | boolean | null | undefined} JSONPrimitive */
/**
 * @template T
 * @typedef {<K extends keyof T>(key: K, value: T[K], oldValue: T[K]) => void} SubscribeListener
 */

/** @template {Object<string, JSONPrimitive>} T */
class Settings {
    /** @type {Partial<T>} */
    properties = {}
    /** @type {Set<SubscribeListener<T>>} */
    listeners = new Set()
    /** @private @type {number | null} */
    _saveTimeout = null

    /**
     * @param {string} uid 
     * @param {T} defaultProperties 
     */
    constructor(uid, defaultProperties) {
        /** @readonly @type {string} */
        this.uid = uid

        /** @readonly @type {T} */
        this.defaultProperties = defaultProperties

        this._loadFromStorage()
    }

    /**
     * @template {keyof T} K
     * @param {K} key
     * @returns {T[K]}
     */
    get(key) {
        if (Object.prototype.hasOwnProperty.call(this.properties, key)) {
            return this.properties[key]
        }
        return this.defaultProperties[key]
    }

    /**
     * @template {keyof T} K
     * @param {K} key
     * @param {T[K]} value 
     */
    set(key, value) {
        if (typeof value === 'number') {
            const p = Math.pow(10, MAX_DECIMAL_PLACES)
            const n = (value * p) * (1 + Number.EPSILON)
            value = /** @type {T[K]} */ (Math.round(n) / p)
        }

        const oldValue = this.get(key)
        if (value === oldValue) return

        if (value !== this.defaultProperties[key]) {
            this.properties[key] = value
        } else {
            delete this.properties[key]
        }

        this.listeners.forEach(listener => listener(key, value, oldValue))
        this._scheduleSave()
    }

    /**
     * Adds a change listener
     * @param {SubscribeListener<T>} listener
     * @param {boolean} [immediate=false]
     */
    subscribe(listener, immediate = false) {
        this.listeners.add(listener)
        if (immediate) {
            for (const key in this.defaultProperties) {
                listener(key, this.get(key), this.defaultProperties[key])
            }
        }
    }

    /**
     * Removes a change listener
     * @param {(key: keyof T, value: T[keyof T]) => void} listener
     */
    unsubscribe(listener) {
        this.listeners.delete(listener)
    }

    /**
     * @template {keyof T} K
     * @param {K} key
     * @returns {Property<T[K]>}
     */
    property(key) {
        const prop = new Property(
            this.defaultProperties[key],
            () => this.get(key),
            (value) => this.set(key, value)
        )

        const wrapper = (changedKey, newValue) => {
            if (changedKey === key) prop._onChange(newValue)
        }

        prop._onDestroy = () => { this.unsubscribe(wrapper) }
        this.subscribe(wrapper)
        
        return prop
    }

    /** @private */
    _loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.uid)
            if (raw) {
                const data = JSON.parse(raw)
                if (data && typeof data === "object") {
                    this.properties = /** @type {Partial<T>} */ (data)
                }
            }
        } catch (err) {
            console.warn("Failed to load settings from localStorage:", err)
        }
    }

    /** @private */
    _scheduleSave() {
        if (this._saveTimeout !== null) {
            clearTimeout(this._saveTimeout)
        }

        this._saveTimeout = setTimeout(() => {
            this._saveTimeout = null
            localStorage.setItem(
                this.uid,
                JSON.stringify(this.properties)
            )
        }, 300)
    }
}

/** @template V */
export class Property {
    /**
     * @param {V} defaultValue  
     * @param {() => V} getter
     * @param {(value: V) => void} setter
     * @param {() => void} onDestroy 
     */
    constructor(defaultValue, getter, setter, onDestroy = null) {
        /** @type {V} */
        this.defaultValue = defaultValue
        this.listeners = new Set()
        this._getter = getter
        this._setter = setter
        this._onDestroy = onDestroy
    }

    /** @returns {V} */
    get() { return this._getter() }

    /** @param {V} value */
    set(value) { this._setter(value) }

    reset() { this._setter(this.defaultValue) }

    /** @param {(value: V) => void} listener */
    subscribe(listener) { this.listeners.add(listener) }

    /** @param {(value: V) => void} listener */
    unsubscribe(listener) { this.listeners.delete(listener) }

    destroy() {
        this.listeners.clear()
        if (this._onDestroy) this._onDestroy()
    }

    /** @param {V} value */
    _onChange(value) { this.listeners.forEach(listener => listener(value)) }
}

export const audioSettings = new Settings("audio-settings", {
    masterGain: 0.5,
    musicGain: 0.8,
    speechGain: 0.8,
    sfxGain: 0.6
})

/** @typedef {"dark" | "light"} UITheme */
/** @typedef {"online" | "michael" | "franklin" | "trevor" | "custom"} UIAccentColor */

export const uiSettings = new Settings("ui-settings", {
    theme: /** @type {UITheme} */ ("dark"),
    accentColor: /** @type {UIAccentColor} */ ("online")
})
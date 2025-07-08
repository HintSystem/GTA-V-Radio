
/**
 * @typedef {Object} IconOptions
 * @prop {string} [IconOptions.svgPath]
 * @prop {string} [IconOptions.className]
 * @prop {Object} [IconOptions.attrs]
 */

/** @template {IconOptions & { variants: Object<string, IconOptions> }} T */
class Icon {
    /** @param {T} options  */
    constructor(options) {
        this.options = options
        this.svgCache = new Map()
    }

    /**
     * Loads SVG content from a path
     * @param {string} svgPath 
     * @returns {Promise<string>}
     */
    async loadSvg(svgPath) {
        if (this.svgCache.has(svgPath)) {
            return this.svgCache.get(svgPath)
        }

        try {
            const response = await fetch(svgPath)
            if (!response.ok) throw new Error(`Failed to load SVG: ${response.status}`)
            
            const svgContent = await response.text()
            this.svgCache.set(svgPath, svgContent)

            return svgContent
        } catch (error) {
            console.error(`Error loading SVG from "${svgPath}":`, error)
            return '<svg></svg>' // Fallback empty SVG
        }
    }

    /**
     * Creates an SVG element with optional attributes
     * @param {string} svgContent 
     * @param {Object} [attrs] 
     * @returns {SVGElement}
     */
    createSvgElement(svgContent, attrs = {}, className = '') {
        const parser = new DOMParser()
        const doc = parser.parseFromString(svgContent, 'image/svg+xml')
        const svgElement = /** @type {any} */ (doc.documentElement)

        if (className) svgElement.setAttribute("class", className)
        svgElement.classList.add("icon")
        
        for (const key in attrs) {
            svgElement.setAttribute(key, attrs[key])
        }

        return svgElement
    }

    /**
     * Merges className from base options and variant options
     * @private
     * @param {string} [baseClassName] 
     * @param {string} [variantClassName] 
     * @returns {string}
     */
    mergeClassNames(baseClassName = '', variantClassName = '') {
        const classes = [baseClassName, variantClassName]
            .filter(Boolean)
            .join(' ')
            .trim()
        return classes
    }

    /** @private */
    mergeOptions(options = {}) {
        return {
            ...this.options,
            ...options,
            attrs: { ...this.options.attrs, ...options.attrs }
        }
    }

    /** @private */
    getVariantOptions(variant) {
        if (!this.options.variants || !this.options.variants[variant]) throw new Error(`Variant "${variant}" not found`)
        return this.options.variants[variant]  
    }

    /**
     * Creates and returns a new SVG icon element
     * @param {Object} [options] - Override options
     * @returns {Promise<SVGElement>}
     */
    async create(options = {}) {
        const mergedOptions = this.mergeOptions(options)
        const svgPath = mergedOptions.svgPath
        
        if (!svgPath) throw new Error('No SVG path specified')

        const svgContent = await this.loadSvg(svgPath)
        return this.createSvgElement(svgContent, mergedOptions.attrs, this.mergeClassNames(this.options.className, options.className))
    }

    /**
     * Returns a new svg icon of this variant
     * @param {keyof T['variants'] | null} name
     * @returns {Promise<SVGElement>}
     */
    async variant(name) {
        const el = await this.create( (name === null) ? {} : this.getVariantOptions(name) )

        if (typeof name === "string") el.setAttribute('data-variant', name)
        return el
    }

    /**
     * Convenience method to create a variant and insert into container
     * @param {HTMLElement} container 
     * @param {keyof T['variants'] | null} variantName 
     * @returns {Promise<SVGElement>}
     */
    async insertVariant(container, variantName) {
        const svgElement = await this.variant(variantName)
        container.appendChild(svgElement)
        return svgElement
    }

    /**
     * Gets the current variant name from an SVG element
     * @param {SVGElement} el 
     * @returns {string|null}
     */
    getCurrentVariant(el) {
        const variantAttr = el.getAttribute('data-variant')
        return variantAttr || null
    }

    /**
     * Replaces an SVG element with a different variant if not already that variant
     * @param {SVGElement} el - The current SVG element
     * @param {keyof T['variants'] | null} variantName - The variant to switch to
     * @returns {Promise<boolean>} - Returns true if updated, false if no change needed
     */
    async setVariant(el, variantName) {
        const currentVariant = this.getCurrentVariant(el)
        if (currentVariant === variantName) { return false }

        const newSvg = await this.variant(variantName)

        el.innerHTML = newSvg.innerHTML
        for (const attr of el.getAttributeNames()) el.removeAttribute(attr)
        for (const attr of newSvg.getAttributeNames()) el.setAttribute(attr, newSvg.getAttribute(attr))

        if (typeof variantName !== "string") el.removeAttribute('data-variant')
        return true
    }
}

const SpeakerIconOptions = {
    svgPath: "assets/icons/speaker.svg",
    className: "speaker-icon",
    variants: {
        off: { svgPath: "assets/icons/speaker-off.svg", className: "speaker-off" }
    }
}

/** @typedef {typeof SpeakerIconOptions} SpeakerIconOptions */
/** @extends Icon<SpeakerIconOptions> */
class SpeakerIcon extends Icon {
    constructor() { super(SpeakerIconOptions) }

    /**
     * Sets the visual volume level (wave count) for the speaker
     * @param {SVGElement} el 
     * @param {0 | 1 | 2 | 3} level 
     */
    setLevel(el, level) {
        const waves = el.querySelectorAll('[id^="wave-"]')
        waves.forEach((/** @type {HTMLElement} */ wave) => {
            const waveLevel = parseInt(wave.id.split('-')[1])
            wave.style.display = (waveLevel <= level) ? '' : 'none'
        })
    }
}

export const Speaker = new SpeakerIcon()

export const Chevron = new Icon({
    svgPath: "assets/icons/chevron-right.svg",
    className: "chevron-icon",
    variants: {
        right: {},
        left: { attrs: { style: "transform: rotate(180deg)" } },
        up: { attrs: { style: "transform: rotate(270deg)" } },
        down: { attrs: { style: "transform: rotate(90deg)" } }
    }
})
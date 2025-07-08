import { mod } from "../utility.js"
import { UIInput, NavController } from "./base-components.js"
import Sounds from "../sounds.js"

/** @typedef {import("./base-components.js").NavItemInfo} NavItemInfo */

/** Horizontal tab bar navigation */
export class TabBar extends NavController {
    /**
     * @param {HTMLElement} tabBarContainerEl
     * @param {HTMLElement} contentContainerEl
     * @param {Array<NavItemInfo>} tabList
     */
    constructor(tabBarContainerEl, contentContainerEl, tabList) {
        for (const tab of tabList) {
            if (tab.title) tab.title = tab.title.toUpperCase()
        }

        tabBarContainerEl.classList.add("tab-bar")
        contentContainerEl.classList.add("tab-bar", "tab-content")

        const tabBarEl = document.createElement("div")
        tabBarEl.className = "tab-list"
        tabBarContainerEl.appendChild(tabBarEl)

        super(
            tabBarEl, 
            contentContainerEl, 
            tabList, 
            {
                selectSound: Sounds.MENU_TAB_SELECT,
                buttonClass: "tab ui-el",
                prevKeys: ["q"],
                nextKeys: ["e"]
            }
        )

        this.element = tabBarContainerEl

        this.leftButton = document.createElement("button")
        this.leftButton.className = "tab-bar-arrow left"
        this.leftButton.onclick = () => { this.setState({ index: mod(this.selectedIndex - 1, this.items.length), selectContent: true }) }
        Chevron.insertVariant(this.leftButton, "left")
        this.element.appendChild(this.leftButton)

        this.rightButton = document.createElement("button")
        this.rightButton.className = "tab-bar-arrow right"
        this.rightButton.onclick = () => { this.setState({ index: mod(this.selectedIndex + 1, this.items.length), selectContent: true }) }
        Chevron.insertVariant(this.rightButton, "right")
        this.element.appendChild(this.rightButton)

        this._onResize = this._onResize.bind(this)        
        
        this.updateTabWidth()
        window.addEventListener("resize", this._onResize)
    }

    updateTabWidth(maxTabs = 6, minTabWidthPx = 150) {
        requestAnimationFrame(() => {
            const tabBarWidth = this.navBarEl.clientWidth
            const gap = parseFloat(getComputedStyle(this.navBarEl).gap) || 0
            let visibleCount = 1

            // Find optimal number of visible tabs
            for (let i = Math.min(this.items.length, maxTabs); i >= 1; i--) {
                const totalGap = gap * (i - 1)
                const availableWidth = tabBarWidth - totalGap
                const perTab = availableWidth / i

                if (perTab >= minTabWidthPx) {
                    visibleCount = i
                    break
                }
            }

            const totalGap = gap * (visibleCount - 1)
            const tabWidthPercent = ((tabBarWidth - totalGap) / visibleCount / tabBarWidth) * 100
            const tabWidth = `${tabWidthPercent.toFixed(4)}%`

            this.navBarEl.style.setProperty('--tab-width', tabWidth)
        });
    }

    /** @private */
    _onResize() {
        this.updateTabWidth()
    }

    destroy() {
        super.destroy()
        window.removeEventListener("resize", this._onResize)
    }
}

/** Vertical menu navigation */
export class MenuSelector extends NavController {
    /** @param {NavItemInfo[]} menuList */
    constructor(...menuList) {
        const menuListEl = document.createElement("div")
        menuListEl.className = "menu-item-list"
        
        const containerEl = document.createElement("div")
        containerEl.className = "menu-content"

        super(
            menuListEl,
            containerEl,
            menuList,
            {
                buttonClass: "menu-item ui-el",
                prevKeys: ["ArrowUp"],
                nextKeys: ["ArrowDown"]
            }
        )

        this.element = document.createElement("div")
        this.element.className = "menu-selector"
        this.element.appendChild(menuListEl)
        this.element.appendChild(containerEl)
    }
}

export class PropertyList extends NavController {
    /** @param {NavItemInfo[]} propertyList */
    constructor(...propertyList) {
        const menuListEl = document.createElement("div")
        menuListEl.className = "property-list menu-item-list ui-bg"

        super(
            menuListEl,
            null,
            propertyList,
            {
                autoId: false,
                buttonClass: "menu-item ui-el",
                prevKeys: ["ArrowUp"],
                nextKeys: ["ArrowDown"]
            }
        )

        this.element = menuListEl
    }
}

import { Property } from "../settings.js"
import { Chevron } from "./icons.js"

/** @template V */
class PropertyInput extends UIInput {
    /** @param {Property<V>} property  */
    constructor(property) {
        super()

        /** @type {Property<V>} */
        this.property = property
        this.property.subscribe(value => { this.onPropValueChanged(value) })
    }

    /** @protected @abstract @param {V} value  */
    onPropValueChanged(value) {}
}

/**
 * @template V
 * @typedef {{ label: string, value: V }} EnumItem
 */

/** 
 * @template V
 * @extends PropertyInput<V>
 */
export class EnumInput extends PropertyInput {
    /** @type {number} */
    selectedIndex = null

    /**
     * @param {Property<V>} property 
     * @param {EnumItem<V>[]} enumList 
     */
    constructor(property, enumList) {
        super(property)

        this.enumList = enumList

        this.element = document.createElement("div")
        this.element.className = "enum-input"

        this.leftButton = document.createElement("button")
        this.leftButton.onclick = () => { this.stepValue(-1) }
        Chevron.insertVariant(this.leftButton, "left")
        this.element.appendChild(this.leftButton)

        this.labelEl = document.createElement("span")
        this.labelEl.className = "enum-label"
        this.element.appendChild(this.labelEl)

        this.rightButton = document.createElement("button")
        this.rightButton.onclick = () => { this.stepValue(1) }
        Chevron.insertVariant(this.rightButton, "right")
        this.element.appendChild(this.rightButton)

        this.onPropValueChanged(this.property.get())
    }

    stepValue(step) {
        this.property.set(this.enumList[ mod(this.selectedIndex + step, this.enumList.length) ].value)
    }

    onPropValueChanged(value) {
        const index = this.enumList.findIndex((enumItem) => enumItem.value === value)
        if (index === -1) {
            this.labelEl.textContent = ""
            return
        }

        this.selectedIndex = index
        this.labelEl.textContent = this.enumList[index].label
    }

    onSelectedChanged(selected) {
        this.element.classList.toggle("selected", selected)
    }

    onInput(event) {
        if (this.selectedIndex === null) return

        if (event.key == "ArrowLeft") {
            this.stepValue(-1)
            return true
        } else if (event.key == "ArrowRight") {
            this.stepValue(1)
            return true
        }
    }
}

/** @extends {PropertyInput<number>} */
export class SliderInput extends PropertyInput {
    isDragging = false

    /**
     * @param {Property<number>} property
     * @param {number} min
     * @param {number} max
     * @param {number} [step=0.05]
     */
    constructor(property, min, max, step = 0.05) {
        super(property)

        this.min = min
        this.max = max
        this.step = step

        this.element = document.createElement("div")
        this.element.className = "slider-input"

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
        this.element.addEventListener("mousedown", this._onMouseDown)
        document.addEventListener("mousemove", this._onMouseMove)
        document.addEventListener("mouseup", this._onMouseUp)

        this._onTouchStart = this._onTouchStart.bind(this)
        this._onTouchMove = this._onTouchMove.bind(this)
        this.element.addEventListener("touchstart", this._onTouchStart, { passive: false })
        document.addEventListener("touchmove", this._onTouchMove, { passive: false })
        document.addEventListener("touchend", this._onMouseUp)

        this.progressBar = document.createElement("div")
        this.progressBar.className = "slider-progress"
        this.onPropValueChanged(this.property.get())

        const barBackground = document.createElement("div")
        barBackground.appendChild(this.progressBar)

        this.element.appendChild(barBackground)
    }

    /** @private */
    _onMouseDown(event) {
        this.isDragging = true
        this._updateFromClientX(event.clientX)
    }

    /** @private */
    _onMouseUp() { this.isDragging = false }

    /** @private */
    _onMouseMove(event) {
        if (!this.isDragging) return
        this._updateFromClientX(event.clientX)
    }

    /** @private */
    _onTouchStart(event) {
        event.preventDefault()
        this.isDragging = true
        this._updateFromClientX(event.touches[0].clientX)
    }

    /** @private */
    _onTouchMove(event) {
        if (!this.isDragging) return

        event.preventDefault()
        this._updateFromClientX(event.touches[0].clientX)
    }

    /** @private */
    _updateFromClientX(clientX) {
        const rect = this.element.getBoundingClientRect()
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const rawValue = this.min + percent * (this.max - this.min)

        // Snap to nearest step
        const steppedValue = Math.round(rawValue / this.step) * this.step
        this.property.set(this._clampValue(steppedValue))
    }

    /** @private */
    _clampValue(value) {
        return Math.min(Math.max(value, this.min), this.max)
    }

    incrementValue(step) {
        this.property.set(this._clampValue(this.property.get() + step))
    }

    onPropValueChanged(value) {
        let percent = (value - this.min) / (this.max - this.min)
        percent = Math.min(Math.max(percent, 0), 1)

        this.progressBar.style.width = `${percent * 100}%`
    }

    onInput(event) {
        if (event.key == "ArrowLeft") {
            this.incrementValue(-this.step)
            return true
        } else if (event.key == "ArrowRight") {
            this.incrementValue(this.step)
            return true
        }
    }

    destroy() {
        super.destroy()
        this.property.destroy()

        document.removeEventListener("mousemove", this._onMouseMove)
        document.removeEventListener("mouseup", this._onMouseUp)
        document.removeEventListener("touchmove", this._onTouchMove)
        document.removeEventListener("touchend", this._onMouseUp)
    }
}
import { mod, isNumeric } from "../utility.js"
import { AudioManager } from "../audio.js"
import Sounds from "../sounds.js"

const MENU_STACK_BASE_ZINDEX = 1000

/** @param {string} path  */
function splitPath(path) {
    if (path === "") return []
    return path.split("/")
}

/** @type {Map<string, UIComponent>} */
const componentRegistry = new Map()
/** @type {Map<string, UIMenu>} */
const menuRegistry = new Map()
/** @type {UIMenu[]} */
let menuStack = []

function updateMenuStackZIndex() {
    for (let i = 0; i < menuStack.length; i++) {
        menuStack[i].element.style.zIndex = (MENU_STACK_BASE_ZINDEX + (menuStack.length - i - 1)).toString()
    }
}

const MenuHistory = {
    getStackState() {
        let stackState = []
        for (const menu of menuStack) {
            /** @type {any} */
            const menuState = menu.stateManager.serialize()
            menuState.uid = menu.uid

            stackState.push(menuState)
        }

        if (stackState.length === 0) stackState = null
        const selectionPath = (menuStack.length > 0) ? `/#${menuStack[0].stateManager.selectionPath}` : "/"
        return { stackState, selectionPath }
    },

    loadStackState(stackState) {
        if (!stackState) return

        // Close menus that are not open in this state
        for (const menu of menuStack) {
            if (!menu.opened) continue

            const index = stackState.findIndex((value) => value.uid === menu.uid)
            if (index === -1) {
                menu.opened = false
                menu.onClose(false)
            }
        }

        menuStack = []
        for (const menuState of stackState) {
            const menu = menuRegistry.get(menuState.uid)
            if (!menu) {
                console.warn(`Tried to load state for menu with uid "${menuState.uid}", but entry in menuRegistry was not found`)
                continue
            }

            menuStack.push(menu)
            if (!menu.opened) {
                menu.opened = true
                menu.onOpen(false)
            }
            menu.stateManager.deserialize(menuState)
        }

        updateMenuStackZIndex()
    },

    loadUrlHash() {
        const selectionPath = location.hash.substring(1)
        if (!selectionPath) return

        const selectionParts = splitPath(selectionPath)
        const menu = menuRegistry.get(selectionParts[0])
        if (!menu) {
            console.warn(`Tried to load selection path from url hash, but menu with uid "${selectionParts[0]}" was not found in menuRegistry`)
            return
        }

        menu.toggleOpen(true)
        menu.stateManager.setSelectionPath(selectionPath, true, true)
    },

    closeAllMenus() {
        for (const menu of menuStack) {
            menu.opened = false
            menu.onClose(false)
        }
        menuStack = []
    },

    push() {
        const { stackState, selectionPath } = this.getStackState()
        console.log("push", selectionPath, stackState)
        history.pushState(stackState, "", selectionPath)
    },

    replace() {
        if (menuStack.length === 0) return

        const { stackState, selectionPath } = this.getStackState()
        console.log("replace", selectionPath, stackState)
        history.replaceState(stackState, "", selectionPath)
    }
}

/** @typedef {string | number | boolean | null | undefined} JSONPrimitive */
/** @typedef {{ [key: string]: (JSONPrimitive | JSONPrimitive[]) }} StateType */

/** @typedef {{ states: Object<string, StateType>, selectionPath: string }} SerializedStateManager */

/**
 * State management system for UI components
 * Uses path-based addressing for deterministic state storage
 */
class UIStateManager {
    loadingState = false

    constructor() {
        /** @type {Map<string, StateType>} */
        this.states = new Map()
        /** @type {string} */
        this.selectionPath = ""
        /** @type {string} */
        this.previousSelectionPath = ""
    }

    /**
     * Get state for a specific path
     * @param {string} path 
     * @returns {StateType|undefined}
     */
    getState(path) {
        return this.states.get(path)
    }

    /**
     * Set state for a specific path
     * @param {string} path 
     * @param {StateType} state 
     */
    setState(path, state) {
        this.states.set(path, state)
    }

    /**
     * Check if a path is selected
     * @param {string} path 
     * @returns {boolean}
     */
    isSelected(path) {
        return this.selectionPath.startsWith(path)
    }

    /**
     * @param {string} path
     * @param {boolean} [updateHistory=true] - If true, selection path is pushed to history (defaults to true)
     * @param {boolean} [forceSelectionGained=false] - If true, onSelectChanged is called on gained selections, even if they were selected previously (defaults to false)
     */
    setSelectionPath(path, updateHistory = true, forceSelectionGained = false) {
        if (path == this.selectionPath) return
        
        this.previousSelectionPath = this.selectionPath
        this.selectionPath = path
        const oldParts = splitPath(this.previousSelectionPath)
        const newParts = splitPath(path)

        const callSelectionChanged = (currentPath, previousPath, isSelected) => {
            let pathSum = []
            let diverged = false
            const forceDiverged = (forceSelectionGained && isSelected)

            for (let i = 0; i < currentPath.length; i++) {
                pathSum.push(currentPath[i])
                if (!diverged && currentPath[i] !== previousPath[i]) diverged = true

                if (diverged || forceDiverged) {
                    const component = componentRegistry.get(pathSum.join("/"))
                    if (component && component instanceof UIInput) {
                        component.onSelectedChanged(isSelected, this.previousSelectionPath, this.selectionPath)
                    }
                }
            }
        }

        // Check gained selections
        callSelectionChanged(newParts, oldParts, true)
        // Check lost selections
        callSelectionChanged(oldParts, newParts, false)

        if (this.loadingState || !updateHistory) return

        if (oldParts.length === 1 || newParts.length <= oldParts.length) MenuHistory.replace()
        else MenuHistory.push()
    }

    /**
     * Get all selected paths in depth-first order (deepest first)
     * @returns {string[]}
     */
    getSelectedPathsDepthFirst() {
        const parts = this.selectionPath.split('/')
        const result = []

        for (let i = parts.length; i >= 1; i--) {
            result.push(parts.slice(0, i).join('/'))
        }

        return result
    }

    /**
     * Serialize entire state to JSON
     * @returns {SerializedStateManager}
     */
    serialize() {
        /** @type {any} */
        const statesObj = {}
        this.states.forEach(function(value, key) {
            statesObj[key] = value
        })

        return {
            states: statesObj,
            selectionPath: this.selectionPath
        }
    }

    /**
     * Load state from serialized JSON
     * @param {SerializedStateManager} serialized 
     */
    deserialize(serialized) {
        this.loadingState = true

        const statesObj = serialized.states || {}
        this.states = new Map(Object.keys(statesObj).map(k => [k, statesObj[k]]))
        
        const pathsByLength = Object.keys(statesObj)
            .filter((v) => componentRegistry.has(v)) // Only load state for components that exist, rely on init to load remaining state
            .sort((a, b) => a.length - b.length) // Load state in ascending order by path length
        for (const path of pathsByLength) {
            const component = componentRegistry.get(path)

            if (!component || !(component instanceof UIInput)) {
                console.warn(`Tried to load state for component "${path}", but entry in componentRegistry was not found`)
                continue
            }
            
            console.log("load", component.constructor.name, path)
            component.setState(statesObj[path])
        }
        this.setSelectionPath(serialized.selectionPath)

        this.loadingState = false
    }

    /** Clear all state */
    clear() {
        this.states.clear()
        this.selectionPath = ""
    }
}

requestAnimationFrame(() => { MenuHistory.loadUrlHash() }) 
window.addEventListener("popstate", (event) => {
    if (event.state) {
        MenuHistory.loadStackState(event.state)
    } else if (location.hash) {
        MenuHistory.loadUrlHash()
    } else {
        MenuHistory.closeAllMenus()
    }
})

document.addEventListener("keydown", (event) => {
    if (menuStack.length > 0) {
        const menu = menuStack[0]
        const selectedPaths = menu.stateManager.getSelectedPathsDepthFirst()
        
        // Start with deepest selected descendant and propagate up
        for (const path of selectedPaths) {
            const component = componentRegistry.get(path)
            if (component && component instanceof UIInput) {
                if (component.onInput(event)) {
                    return // Event was consumed
                }
            }
        }
    } else {
        // Handle unopened menus
        menuRegistry.forEach((menu) => {
            menu.onInput(event)
        })
    }
})

export class UIComponent {
    /** @type {HTMLElement | null} */
    element = null
    /** @type {string} */
    path = ""

    /**
     * Set the path for this component and register it
     * @param {string} path
     */
    setPath(path) {
        if (this.path) {
            componentRegistry.delete(this.path)
        }
        this.path = path
        componentRegistry.set(path, this)
    }

    /** @abstract */
    destroy() {
        if (this.path) {
            componentRegistry.delete(this.path)
        }
    }
}

/** UI element that accepts user input */
export class UIInput extends UIComponent {
    /** @type {UIInput | UIMenu | null} */
    parent = null
    /** @type {UIMenu} */
    origin = null

    /**
     * @param {UIInput | UIMenu} parent
     * @param {string} [pathId=null]
     */
    init(parent, pathId = null) {
        this.parent = parent
        this.origin = (parent instanceof UIMenu) ? parent : parent.origin
        
        // Generate deterministic path based on parent path and component type/index or just use given pathId
        const inputPath = (pathId === null)
            ? `${this.constructor.name.toLowerCase()}_${this._getSiblingIndex(parent)}` : pathId

        this.setPath((inputPath !== '') ? `${parent.path}/${inputPath}` : parent.path)

        const state = this.getState()
        if (state) this.onStateChanged(state)
        if (this.selected) this.onSelectedChanged(true, this.origin.stateManager.previousSelectionPath, this.origin.stateManager.selectionPath)
    }

    /**
     * Initializes this component as the default for the origin, meaning the path is the same as the origin and it will start selected
     * @param {UIMenu} origin
     */
    initAsDefault(origin) {
        this.init(origin, "")
        origin.stateManager.setSelectionPath(origin.path, false)
    }

    /**
     * Calculate sibling index deterministically
     * @param {UIInput | UIMenu} parent
     * @returns {number}
     */
    _getSiblingIndex(parent) {
        // This should be overridden by subclasses to provide deterministic indexing
        // For now, use a simple counter based on existing children
        const existingChildren = Array.from(componentRegistry.values())
            .filter(comp => comp.path.startsWith(parent.path + '/'))
            .filter(comp => comp.constructor === this.constructor)
        return existingChildren.length
    }

    /**
     * Get current state from state manager
     * @returns {StateType}
     */
    getState() {
        return this.origin.stateManager.getState(this.path)
    }

    /**
     * Update state in state manager
     * @param {StateType} state
     */
    setState(state) {
        this.origin.stateManager.setState(this.path, state)
        this.onStateChanged(state)
    }

    /**
     * Check if this component is selected
     * @returns {boolean}
     */
    get selected() { return this.origin.stateManager.isSelected(this.path) }

    /**
     * Called when state changes
     * @abstract
     * @param {StateType} state
     */
    onStateChanged(state) {}

    /**
     * Called when this input gains/loses selection
     * @abstract
     * @param {boolean} selected
     * @param {string} oldPath
     * @param {string} newPath
     */
    onSelectedChanged(selected, oldPath, newPath) {}

    /**
     * Called whenever a key is pressed down
     * @abstract
     * @param {KeyboardEvent} event
     * @returns {boolean|void} If true, this input event is consumed and ancestors will not receive it
     */
    onInput(event) { return false }

    destroy() {
        super.destroy()
        if (this.origin && !this.origin.stateManager.loadingState) {
            this.origin.stateManager.states.delete(this.path)
        }
    }
}

/** @typedef {"vw" | "vh" | "vmin" | "vmax"} ScreenCSSUnit */

/**
 * @param {number} value 
 * @param {ScreenCSSUnit} unit 
 */
function cssUnitToPixels(value, unit) {
    switch(unit) {
        case 'vh':
            return (value * window.innerHeight) / 100
        case 'vw':
            return (value * window.innerWidth) / 100
        case 'vmin':
            return (value * Math.min(window.innerWidth, window.innerHeight)) / 100
        case 'vmax':
            return (value * Math.max(window.innerWidth, window.innerHeight)) / 100
        default:
            return 0
    }
}

/** UI element that serves as the origin for any element that accepts user input */
export class UIMenu extends UIInput {
    stateManager = new UIStateManager()
    opened = false
    /** @private @type {number|null} */
    fontScaleValue = null
    /** @private @type {ScreenCSSUnit|null} */
    fontScaleUnit = null
    /** @private @type {number} */
    prevFontSize = null

    /**
     * @param {string} uid 
     * @param {HTMLDivElement} element 
     */
    constructor(uid, element) {
        super()
        /** @readonly @type {string} */
        this.uid = uid
        this.setPath(uid)

        if (menuRegistry.has(this.uid)) console.error(`UIMenu uid "${uid}" is already present in menuRegistry`)
        menuRegistry.set(this.uid, this)

        this.element = element
        this.element.classList.add("ui-menu")
        this._updateFontScale = this._updateFontScale.bind(this)
        this.setFontScaling(1.8, "vh")
    }

    /** @private */
    _updateFontScale() {
        // Avoid inconsistent gap sizes by keeping floating point precision low
        const sizeInPixels = Math.floor(cssUnitToPixels(this.fontScaleValue, this.fontScaleUnit) * 2) / 2
        if (sizeInPixels == this.prevFontSize) return
    
        this.prevFontSize = sizeInPixels
        this.element.style.fontSize = `${sizeInPixels}px`
    }

    /**
     * @overload
     * @param {null} value - If null, font scaling will be disabled 
     */
    /**
     * @overload
     * @param {number} value
     * @param {ScreenCSSUnit} cssUnit 
     */
    setFontScaling(value, cssUnit) {
        window.removeEventListener("resize", this._updateFontScale)

        if (value === null || cssUnit === null) {
            this.fontScaleValue = null
            this.fontScaleUnit = null
            return
        }
        this.fontScaleValue = value
        this.fontScaleUnit = cssUnit
        
        this._updateFontScale()
        window.addEventListener("resize", this._updateFontScale)
    }

    /** @param {boolean} [force=null] */
    toggleOpen(force = null) {
        if (force === this.opened) return
        if (force === null) force = !this.opened

        this.opened = force
        if (force) {
            menuStack.unshift(this)
            this.onOpen(true)
        } else {
            const index = menuStack.indexOf(this)
            if (index !== -1) menuStack.splice(index, 1)
            this.onClose(true)
        }

        updateMenuStackZIndex()
        MenuHistory.push()
    }

    /** @abstract @param {boolean} isUserInput  */
    onOpen(isUserInput) {}

    /** @abstract @param {boolean} isUserInput  */
    onClose(isUserInput) {}
}

/** 
 * @typedef {{
 *  id?: string
 *  title: string
 *  content?: (() => Promise<UIComponent | HTMLElement> | UIComponent | HTMLElement)
 *  inlineContent?: (() => UIComponent | HTMLElement)
 *  [key: string]: any
 * }} NavItemInfo
 */

/** @typedef {NavItemInfo & {buttonEl: HTMLButtonElement, inlineContentEl?: UIComponent | HTMLElement}} NavItem */

/** @typedef {{index: number, selectContent: boolean}} NavState */

/** Base navigation controller that handles selection logic and keyboard navigation */
export class NavController extends UIInput {
    /** @type {NavItem[]} */
    items = []
    /** @type {Set<string>} */
    itemIds = new Set()

    /** @type {number} */
    selectedIndex = null
    /** @type {UIComponent | HTMLElement} */
    currentContent = null
    /** @type {string} */
    buttonClass = ""
    /** @type {string} */
    containerClass = ""

    /**
     * @param {HTMLElement} navBarEl - Container for navigation buttons
     * @param {HTMLElement | null} contentContainerEl - Container for content, if null menu content will not be loaded
     * @param {Array<NavItemInfo>} itemsList - List of navigation items
     * @param {Object} options - Configuration options
     * @param {boolean} [options.autoId] - If true, an id is created based on the title of the item (defaults to true)
     * @param {string} [options.buttonClass] - CSS class for buttons
     * @param {string} [options.selectedClass] - CSS class for selected state (defaults to "selected")
     * @param {AudioManager} [options.selectSound] - Sound that plays when an item is selected
     * @param {string[]} [options.prevKeys] - Keys that select previous item
     * @param {string[]} [options.nextKeys] - Keys that select next item
     * @param {string[]} [options.activateKeys] - Keys that activate current selection
     */
    constructor(navBarEl, contentContainerEl, itemsList, options = {}) {
        super()

        this.navBarEl = navBarEl
        this.contentContainerEl = contentContainerEl
        if (this.contentContainerEl) this.contentContainerEl.classList.toggle("hidden", true)
        this.buttonClass = options.buttonClass || ""
        this.selectedClass = options.selectedClass || "selected"
        this.prevKeys = options.prevKeys || []
        this.nextKeys = options.nextKeys || []
        this.activateKeys = options.activateKeys || ["Enter"]
        this.selectSound = options.selectSound || Sounds.MENU_SELECT

        const autoId = (options.autoId == null) ? true : options.autoId

        // Create buttons for each item
        for (let i = 0; i < itemsList.length; i++) {
            const button = document.createElement("button")
            button.className = this.buttonClass
            
            const itemText = document.createElement("span")
            itemText.textContent = itemsList[i].title

            button.appendChild(itemText)
            button.addEventListener("click", () => {
                this.setState({ index: i, selectContent: true })
            })
            
            const itemIndexId = (i + 1).toString()
            const item = /** @type {NavItem} */ (itemsList[i])
            item.buttonEl = button

            if (typeof item.inlineContent === 'function') {
                item.inlineContentEl = item.inlineContent()

                const inlineContainer = document.createElement("span")
                inlineContainer.className = "inline-content"

                inlineContainer.appendChild(this._getElement(item.inlineContentEl))
                button.appendChild(inlineContainer)
            }

            if (!item.id && autoId) {
                item.id = item.title.trim().toLowerCase().replace(/\s+/g, "-")
            } else if (isNumeric(item.id)) {
                console.warn(`Item id "${item.id}" cannot be a number - replacing with index`)
                item.id = itemIndexId
            }

            if (!item.id) item.id = itemIndexId

            if (this.itemIds.has(item.id)) {
                console.warn(`Item id "${item.id}" is not unique - replacing with index`)
                item.id = itemIndexId
            }

            this.items.push(item)
            this.itemIds.add(item.id)
            navBarEl.appendChild(button)
        }
    }
    
    /** @type {UIInput['init']} */
    init(parent, pathId) {
        super.init(parent, pathId)

        // Show menu content preview
        if (!this.currentContent) this._replaceContent(this.items[0])
    }

    /** @private */
    _getElement(component) {
        return (component instanceof UIComponent)
            ? component.element : component
    }

    /** @private @returns {UIInput|null} */
    _getInlineInputEl(index = null) {
        if (index === null) index = this.selectedIndex
        const inlineEl = this.items[index || 0]?.inlineContentEl
        if (inlineEl instanceof UIInput) return inlineEl
        
        return null
    }

    /** @private */
    _destroyContent() {
        if (this.currentContent instanceof UIComponent) this.currentContent.destroy()
        this.currentContent = null
    }

    /** @private @param {NavItemInfo} itemInfo  */
    _replaceContent(itemInfo) {
        if (!itemInfo || !this.contentContainerEl) return

        this._destroyContent()
        this.contentContainerEl.textContent = ''
        this.contentContainerEl.classList.remove("fade-in")
        
        if (itemInfo?.content) {
            Promise.resolve(itemInfo.content()).then((content) => {
                this._destroyContent()
                this.contentContainerEl.textContent = ''
                requestAnimationFrame(() => this.contentContainerEl.classList.add("fade-in"))

                this.currentContent = content
                const contentEl = this._getElement(this.currentContent)
            
                if (this.currentContent instanceof UIInput) this.currentContent.init(this, itemInfo.id)
                if (contentEl) this.contentContainerEl.appendChild(contentEl)
            })
        }
    }

    /** @private */
    _deselectItems() {
        for (const item of this.items) {
            item.buttonEl.classList.remove(this.selectedClass)
        }
    }

    /** @param {NavState} state  */
    onStateChanged(state) {
        const itemInfo = this.items[state.index]
        if (!itemInfo) return

        if (this.contentContainerEl) {
            this.contentContainerEl.classList.toggle("disabled", !state.selectContent)

            if (itemInfo.content) {
                this.contentContainerEl.classList.toggle("hidden", !state.selectContent)
                this.navBarEl.classList.toggle("hidden", state.selectContent)
            }
        }

        if (state.index !== this.selectedIndex) {
            if (this.selectedIndex != null) this.selectSound.play()
            this._getInlineInputEl()?.onSelectedChanged(false, this.origin.stateManager.previousSelectionPath, this.origin.stateManager.selectionPath)
            this._getInlineInputEl(state.index)?.onSelectedChanged(true, this.origin.stateManager.previousSelectionPath, this.origin.stateManager.selectionPath)

            this._replaceContent(itemInfo)
            
            // Update UI state
            this._deselectItems()
            itemInfo.buttonEl.classList.add(this.selectedClass)
            itemInfo.buttonEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }

        // Update selection
        if (state.selectContent) {
            const itemPath = `${this.path}/${itemInfo.id}`
            
            if (!this.origin.stateManager.isSelected(itemPath)) {
                this.origin.stateManager.setSelectionPath(itemPath)
                if (itemInfo.content && state.index === this.selectedIndex) Sounds.MENU_OPEN.play()
            } 
        } else {
            this.origin.stateManager.setSelectionPath(this.path)
        }

        this.selectedIndex = state.index
    }
    
    onSelectedChanged(selected, oldPath, newPath) {
        if (selected) {
            const itemId = splitPath(newPath)[splitPath(this.path).length]
            const index = this.items.findIndex((value) => value.id === itemId) // Find item that should be selected based on new selection path
            
            if (index === -1) {
                if (this.selectedIndex === null) this.setState({ index: 0, selectContent: false })
            } else {
                this.setState({ index, selectContent: true })
            }
        } else {
            this.selectedIndex = null
            this._deselectItems()
        }
    }

    onInput(event) {
        let inlineInput = !!this._getInlineInputEl()?.onInput(event) // Give control to inline content first

        if (this.prevKeys.includes(event.key)) {
            this.setState({ index: mod(this.selectedIndex - 1, this.items.length), selectContent: false })
            return true
        } else if (this.nextKeys.includes(event.key)) {
            this.setState({ index: mod(this.selectedIndex + 1, this.items.length), selectContent: false })
            return true
        } else if (this.activateKeys.includes(event.key)) {
            event.preventDefault() // Prevent interference from browser keyboard navigation
            this.setState({ index: this.selectedIndex || 0, selectContent: true })
            return true
        }

        if (inlineInput) return inlineInput
    }

    destroy() {
        super.destroy()
        for (const item of this.items) {
            if (item.inlineContentEl instanceof UIComponent) item.inlineContentEl.destroy()
        }
        if (this.currentContent instanceof UIComponent) this.currentContent.destroy()
    }
}
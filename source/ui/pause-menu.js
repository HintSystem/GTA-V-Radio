import { radioMetaPromise } from "../constants.js"
import { stationList } from "../station-manager.js"
import { getGtaOnlineTime } from "../utility.js"
import { audioSettings, uiSettings } from "../settings.js"
import Sounds from "../sounds.js"

import { UIMenu } from "./base-components.js"
import { TabBar, MenuSelector, PropertyList, EnumInput, SliderInput } from "./components.js"

export default class PauseMenu extends UIMenu {
    /** @private @type {number} */
    _timeInterval = null

    /**
     * @param {string} uid 
     * @param {HTMLElement} backgroundContent - optional element that effects will be aplied to when toggling menu
     */
    constructor(uid, backgroundContent = null) {
        const element = document.createElement("div")
        element.className = "pauseMenu"
        element.innerHTML = `
        <div class="content">
            <div class="header">
                <div class="top">
                    <div class="title">Grand Theft Auto V Radio</div>
                    <div class="info"><span class="time"></span></div>
                </div>
                <div class="tab-bar"></div>
            </div>
            <div class="tab-content"></div>
        </div>
        `

        super(uid, element)

        if (backgroundContent) { backgroundContent.classList.add("pauseMenuBackgroundContent") } 
        this.backgroundContent = backgroundContent

        this.tabBar = new TabBar(
            this.element.querySelector(".header .tab-bar"),
            this.element.querySelector(".content .tab-content"),
            [
                {
                    title: "Settings",
                    content: () => new MenuSelector(
                        {
                            title: "Audio",
                            content: () => new PropertyList(
                                {
                                    title: "Master Volume",
                                    inlineContent: () => new SliderInput(audioSettings.property("masterGain"), 0, 1)
                                },
                                {
                                    title: "Music Volume",
                                    inlineContent: () => new SliderInput(audioSettings.property("musicGain"), 0, 1)
                                },
                                {
                                    title: "Speech Volume",
                                    inlineContent: () => new SliderInput(audioSettings.property("speechGain"), 0, 1)
                                },
                                {
                                    title: "SFX Volume",
                                    inlineContent: () => new SliderInput(audioSettings.property("sfxGain"), 0, 1)
                                }
                            ) 
                        },
                        {
                            title: "User Interface",
                            content: () => new PropertyList(
                                {
                                    title: "Theme",
                                    inlineContent: () => new EnumInput(uiSettings.property("theme"), [
                                        { label: "Dark", value: "dark" }, { label: "Light", value: "light" }
                                    ])
                                },
                                {
                                    title: "Accent Color",
                                    inlineContent: () => new EnumInput(uiSettings.property("accentColor"), [
                                        { label: "Online", value: "online" }, { label: "Michael", value: "michael" }, { label: "Franklin", value: "franklin" }, { label: "Trevor", value: "trevor" }
                                    ])
                                }
                            )
                        }
                    )
                },
                {
                    title: "Stations",
                    content: async () => {
                        await radioMetaPromise
                        await new Promise(requestAnimationFrame)

                        const stationMenuList = []
                        for (const station of stationList) {
                            await station.loadMeta()
                            stationMenuList.push({
                                title: station.meta.info.title
                            })
                        }
                        
                        return new MenuSelector(...stationMenuList)
                    }
                }
            ]
        )
        this.tabBar.initAsDefault(this)

        this.element.addEventListener("click", (event) => {
            if (event.target != this.element) return
            this.toggleOpen(false)
        })

        const timeEl = this.element.querySelector(".header .time")
        function updateTime() {
            const { hh, mm, weekdayName } = getGtaOnlineTime()
            timeEl.textContent = `${weekdayName.toUpperCase()} ${hh}:${mm}`
        }

        updateTime()
        this._timeInterval = setInterval(updateTime, 1000)
    }

    onOpen() {
        Sounds.PAUSE_MENU_OPEN.play()
        this.element.classList.add("show")
        
        const main = document.getElementById("mainContent")
        main.classList.add("zoom-start")
        main.classList.remove("zoom-out")

        // Wait a tick, then smooth zoom-out
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                main.classList.remove("zoom-start")
                main.classList.add("zoom-out")
            })
        })
    }

    onClose() {
        Sounds.PAUSE_MENU_CLOSE.play()
        this.element.classList.remove("show")
        
        document.getElementById("mainContent").classList.remove("zoom-start", "zoom-out")
    }

    onInput(event) {
        if (event.key == "p") {
            this.toggleOpen()
        }
    }

    destroy() {
        clearInterval(this._timeInterval)
    }
}
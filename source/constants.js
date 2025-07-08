/** @type {HTMLLinkElement} */
let defaultPageIcon = null

function setDefaultPageIcon() {
    let element = document.getElementById("pageIcon")
    if (!element) return

    defaultPageIcon = /** @type {HTMLLinkElement} */ (element.cloneNode())
    return /** @type {HTMLLinkElement} */ (element)
}

export const pageIcon = {
    element: setDefaultPageIcon(),
    init: () => {
        if (pageIcon.element) return
        document.addEventListener("DOMContentLoaded", () => {
            pageIcon.element = setDefaultPageIcon()
        }, { once: true })
    },
    reset: () => {
        if (!pageIcon.element || !defaultPageIcon) return

        const parent = pageIcon.element.parentNode
        if (!parent) return

        const resetIcon = defaultPageIcon.cloneNode()
        parent.removeChild(pageIcon.element)
        parent.appendChild(resetIcon)
        pageIcon.element = /** @type {HTMLLinkElement} */ (resetIcon)
    }
}
pageIcon.init()

export const localDataPath = "data/"
export const remoteDataPath = "https://raw.githubusercontent.com/RegalTerritory/GTA-V-Radio-Stations/master/"

let lastUsedPath = localDataPath;

/** @returns {Promise<import("./types").RadioMetadata>} */
export async function loadRadioMeta() {
    try {
        const localResponse = await fetch(localDataPath + "radio.json")
        if (!localResponse.ok) throw new Error("Local file not found")

        return await localResponse.json()
    } catch (localError) {
        console.warn("Local radio meta not found, trying remote...", localError)

        try {
            const remoteResponse = await fetch(remoteDataPath + "radio.json")
            if (!remoteResponse.ok) throw new Error("Remote file not found")

            lastUsedPath = remoteDataPath
            return await remoteResponse.json()
        } catch (remoteError) {
            console.error("Failed to load radio meta from both sources.", remoteError)
            throw remoteError
        }
    }
}

/** @type {import("./types").RadioMetadata} */
export let radioMeta

export const radioMetaPromise = loadRadioMeta()
radioMetaPromise.then((meta) => {radioMeta = meta})

export function getDataPath() {
    return lastUsedPath
}
export class SeededPRNG {
    constructor(seed) {
        /** Equal seed values will deterministically generate the same set of pseudo random numbers */
        this.seed = seed
        /** The index determines which number to generate from the pseudo random set, making it possible to always generate the same number */
        this.index = 0
    }

    /**
     * Generates a pseudo random number from 0 to 4294967295 (0xFFFFFFFF) based on `seed` and `index`.
     * @returns {number}
     */
    generate() {
        // Simple hash function (xorshift-style)
        let value = this.seed ^ this.index
        value = (value ^ (value >>> 21)) * 0x45d9f3b
        value = (value ^ (value >>> 15)) * 0x45d9f3b
        value = value ^ (value >>> 13)

        return value >>> 0
    }

    /**
     * Generates a pseudo random number and increments `index` by 1
     * @returns {number} value from 0 to 4294967295 (0xFFFFFFFF)
     */
    next() {
        const value = this.generate()
        this.index++
        return value
    }

    /**
     * Converts generated number to a float from 0 to 1
     * @returns {number}
     */
    toFloat(number) { return number / 0xFFFFFFFF }
}

/** Stores the past `limit` numbers, going over the limit will dequeue a number */
class RecentSet {
    constructor(limit) {
      this._limit = limit
      this.set = new Set()
      this.queue = []
    }

    get limit() { return this._limit }

    set limit(value) {
        if (this._limit === value) { return }
        this._limit = value
        while (this.queue.length > this._limit) { this.shift() }
    }

    shift() {
        const oldest = this.queue.shift()
        this.set.delete(oldest)
    }
  
    add(num) {
        if (this.queue.length === this._limit) { this.shift() }
        this.queue.push(num)
        this.set.add(num)
    }
  
    has(num) { return this.set.has(num) }
}

export class UsedRandoms {
    /** @type {Map<string, RecentSet>} - Stores all historical numbers in a RecentSet, indexed by `id` */
    map
    /** @type {number} - Represents the maximum value for `historyLimit` */
    maxLimit

    /** @param {number} maxLimit - If present, limits `historyLimit` to this number */
    constructor(maxLimit = null) {
        this.map = new Map()
        this.maxLimit = maxLimit
    }

    /**
     * Returns a number from `generator` that tries to be unique from the last `historyLimit` numbers
     * @param {string} id - Identifier for getting the RecentSet
     * @param {number} historyLimit - The amount of numbers to store and check for uniqueness
     * @param {() => number} generator - Function for generating random numbers
     */
    ensureUnique(id, historyLimit, generator) {
        if (this.maxLimit) { historyLimit = Math.min(this.maxLimit, historyLimit) }
        if (!this.map.has(id)) {
            this.map.set(id, new RecentSet(historyLimit))
        }

        const recentSet = this.map.get(id)
        recentSet.limit = historyLimit

        const maxAttempts = 50
        let attempts = 0
        let candidate
        do {
            candidate = generator()
            attempts++
            if (attempts > maxAttempts) {
                console.warn(`Unable to find a unique value for UsedRandom '${id}' after ${maxAttempts} attempts`)
                break
            }
        } while (recentSet.has(candidate))
        
        //if (attempts > 1) { console.log(`Generating unique number for '${id}' took ${attempts} attempts`) }
        
        recentSet.add(candidate)
        return candidate
    }
}
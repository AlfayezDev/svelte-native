// localStorage can throw (private windows, blocked site data) or be empty; every read and write is allowed to fail.
export function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function write(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// the choice lasts until the page is closed
	}
}

/** localStorage key of the chosen theme ('light' | 'dark') */
export const THEME_KEY = 'fitcast-theme';

/**
 * Runs in <head> before the first paint (layout.tsx): the saved choice, or the system setting when there is none,
 * so a dark-theme visitor never sees a white flash. Kept out of the client component so the server layout gets the
 * string itself, not a client reference.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

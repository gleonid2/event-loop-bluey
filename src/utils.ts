export function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) { return `${totalSec}s`; }
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) { return `${mins}m ${secs}s`; }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
}

export function generateBestPracticesPath(description: string): string {
    return `best_practices/${slugify(description)}.md`;
}

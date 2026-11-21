export const hms = (s: number) => ((m) => `${Math.floor(m / 60)} h ${m % 60} min`)(Math.round(s / 60));

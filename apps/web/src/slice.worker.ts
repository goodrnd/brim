// Slices off the main thread: big imports take seconds and would freeze the tab.
import {slice} from '@brim/core/slicer.ts';

onmessage = (e: MessageEvent<Parameters<typeof slice>>) => postMessage(slice(...e.data));

# Architecture

## Main Flow

1. The renderer collects a folder path.
2. The renderer calls the preload bridge.
3. IPC hands the request to the main-process services.
4. The service discovers image files with `fast-glob`.
5. The selected pass returns duplicate groups back to the renderer.

## Fast Pass

- Uses `imghash`.
- Computes perceptual hashes for 0, 90, 180, and 270 degree rotations.
- Stores hashes in a `Map<string, string>` so lookups are O(1).
- Uses union-find to merge groups if multiple rotated hashes connect them.

## UI

- Plain TypeScript DOM renderer.
- Folder input plus Browse and Fast Pass buttons.
- Summary cards and duplicate-group cards are rendered as HTML strings.

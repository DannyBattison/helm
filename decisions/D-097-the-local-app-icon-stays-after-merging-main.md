## D-97 · 2026-10-25 · The local app icon stays after merging main
Main's later commits drew another icon (an accent-coloured wheel on a transparent background). The merge keeps the wheel on a rounded dark tile from the companion work, since it is the one in use here; swapping is a matter of replacing `build/icon.*`.
Why: the two icons conflicted file for file, and one had to be chosen.

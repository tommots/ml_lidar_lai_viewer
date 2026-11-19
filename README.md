# LAI canopy viewer (preview)

An interactive 3D viewer of UAV LiDAR point clouds and of the leaf area index (LAI) that machine
learning models predict from them: the vertical LAI profile (the partial LAI of each 2 m height
bin) and the total LAI of every 2 m × 2 m prediction column. It accompanies the paper
*Predicting Forest Leaf Area Index from UAV LiDAR with Synthetic-to-Real Machine Learning* (DOI coming soon).

## What the preview shows

- **Synthetic stands:** 7 test stands, with their LAI labels from the leaf meshes and the
  predictions of the models that were not trained on them.
- **ECOSENSE forest:** all 24 reference positions on 4 of the 38
  LiDAR acquisition dates (2025-08-07, 2025-11-04, 2026-02-25 and 2026-04-17), with the model predictions and the field reference HDHP-LAI.
- **Points:** at most 1 million points per synthetic stand and 500,000 per ECOSENSE data set, uniform subsamples (ECOSENSE: of the points in the prediction columns around the reference position).

The Help in the viewer explains the data, the layers and the controls.

## Run it locally

The site is static, so any web server works. In this folder:

    python3 -m http.server 8000

Then open <http://localhost:8000/>. Opening `index.html` directly from the disk does not work,
because browsers block module scripts and data requests on `file://` URLs.

## Citation and license

When you use the viewer or its data, please cite the paper, *Predicting Forest Leaf Area Index from UAV LiDAR with Synthetic-to-Real Machine Learning* (DOI coming soon), the data (DOI coming soon), and the data sources below.

- **Code:** MIT license (`LICENSE`).
- **Data** (`catalog.json` and `cache/`): CC BY 4.0 (`LICENSE-DATA`).

## Data and software

- ECOSENSE point clouds: Gassilloud, Koch & Goeritz (2026),
  <https://doi.org/10.64898/2026.09.16.751970>
- Field LAI: the methods and the data of autumn 2024 (DHP-LAI, LT-LAI), Lotz et al. (2026),
  <https://doi.org/10.5194/bg-23-1949-2026>; the HDHP-LAI series to 2026, the paper above
- Synthetic stands: The Grove (van Keulen, 2025), growpy (Sperlich & Jaksztat, 2026) and HELIOS++
  (Winiwarter et al., 2022)
- three.js r160 (MIT license), included in `js/lib/three/`

## Feedback

Questions and suggestions are welcome as GitHub issues.

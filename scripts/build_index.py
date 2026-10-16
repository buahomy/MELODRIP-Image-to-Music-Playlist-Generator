"""Precompute the lyrics TF-IDF index used by the web app.

The original Streamlit app ran TfidfVectorizer at startup and, for each
keyword, took cosine_similarity(tfidf.transform([keyword]), lyrics_matrix).
A single-word query vector is a unit vector on that term, and every lyrics
row is l2-normalised, so that cosine is simply the row's weight for the term.
This script stores those weights as an inverted index (term -> top songs),
which lets a serverless function score keywords with a lookup instead of
loading scikit-learn.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/build_index.py [--csv spotify_millsongdata.csv] [--top 60]
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=str(ROOT / "spotify_millsongdata.csv"))
    parser.add_argument("--out", default=str(ROOT / "data" / "lyrics-index.json"))
    parser.add_argument("--top", type=int, default=60, help="songs kept per term")
    parser.add_argument("--sample", type=int, default=0, help="random sample size (0 = all songs)")
    args = parser.parse_args()

    df = pd.read_csv(args.csv, low_memory=False)
    df = df.dropna(subset=["text"]).drop_duplicates(subset=["text"]).reset_index(drop=True)
    df["text"] = df["text"].str.replace(r"\n", "", regex=True)
    if args.sample:
        df = df.sample(n=args.sample, random_state=42).reset_index(drop=True)

    tfidf = TfidfVectorizer(stop_words="english")
    matrix = tfidf.fit_transform(df["text"]).tocsc()
    vocab = tfidf.get_feature_names_out()

    postings = {}
    for col, term in enumerate(vocab):
        start, end = matrix.indptr[col], matrix.indptr[col + 1]
        rows, weights = matrix.indices[start:end], matrix.data[start:end]
        if len(rows) > args.top:
            keep = np.argpartition(-weights, args.top)[: args.top]
            rows, weights = rows[keep], weights[keep]
        order = np.argsort(-weights)
        # Flat [song, weight*1e4, song, weight*1e4, ...] keeps the JSON small.
        flat = []
        for r, w in zip(rows[order], weights[order]):
            flat.extend((int(r), int(round(float(w) * 10000))))
        postings[term] = flat

    out = {
        "songs": df[["song", "artist"]].astype(str).values.tolist(),
        "terms": postings,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_mb = Path(args.out).stat().st_size / 1e6
    print(f"{len(df)} songs, {len(vocab)} terms -> {args.out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()

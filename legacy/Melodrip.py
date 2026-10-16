import requests
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration
import nltk
from nltk.tokenize import word_tokenize, sent_tokenize
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer
import networkx as nx
import pandas as pd
import streamlit as st
import matplotlib.pyplot as plt
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

nltk.download('punkt')
nltk.download('stopwords')

@st.cache_resource
def load_model():
    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-large")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-large")
    return processor, model

@st.cache_data
def load_data():
    url = "https://drive.google.com/uc?export=download&id=1vf838bwv1pxXBgrQxojUGvUJwzWCGsCZ"
    df = pd.read_csv(url, low_memory=False)
    df['text'] = df['text'].str.replace(r'\n', '', regex=True)
    df = df.sample(n=10000, random_state=42)  # Reduce memory
    return df

@st.cache_resource
def compute_tfidf(texts):
    tfidf = TfidfVectorizer(stop_words='english')
    matrix = tfidf.fit_transform(texts)
    return tfidf, matrix

def preprocessing(text):
    sentences = sent_tokenize(text)
    words = [word_tokenize(sentence.lower()) for sentence in sentences]
    stop_words = set(stopwords.words('english'))
    filtered_words = [[word for word in sentence if word.isalnum() and word not in stop_words] for sentence in words]
    stemmer = PorterStemmer()
    stemmed_words = [[stemmer.stem(word) for word in sentence] for sentence in filtered_words]
    return stemmed_words

def buildGraph(words):
    graph = nx.Graph()
    for sentence in words:
        for word in sentence:
            graph.add_node(word)
    for sentence in words:
        for i, word1 in enumerate(sentence):
            for j, word2 in enumerate(sentence):
                if i != j:
                    graph.add_edge(word1, word2)
    return graph

def textRank(graph, num_iterations=100, d=0.85):
    scores = {node: 1.0 for node in graph.nodes()}
    for _ in range(num_iterations):
        next_scores = {}
        for node in graph.nodes():
            score = 1 - d
            for neighbor in graph.neighbors(node):
                score += d * (scores[neighbor] / len(list(graph.neighbors(neighbor))))
            next_scores[node] = score
        scores = next_scores
    return scores

def extractKeywords(text, num_keywords=5):
    words = preprocessing(text)
    graph = buildGraph(words)
    scores = textRank(graph)
    ranked_words = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [word for word, _ in ranked_words[:num_keywords]]

def songRecommender(keywords, tfidf, lyrics_matrix, songs):
    recommendations = {}
    for keyword in keywords:
        keyword_tfidf = tfidf.transform([keyword])
        keyword_similarity = cosine_similarity(keyword_tfidf, lyrics_matrix)
        for i, song in enumerate(songs['text']):
            if song not in recommendations:
                recommendations[song] = keyword_similarity[0][i]
            else:
                recommendations[song] += keyword_similarity[0][i]
    ranked = sorted(recommendations.items(), key=lambda x: x[1], reverse=True)
    return ranked

def printTopFive(recommendations, songs, n=5):
    top_five = []
    for song, score in recommendations[:n]:
        match = songs[songs['text'] == song]
        if not match.empty:
            row = match.iloc[0]
            top_five.append((row['song'], row['artist'], score))
    return top_five

def main():
    st.title("Playlist Recommendation from Image Captioning")

    processor, model = load_model()
    songs = load_data()
    tfidf, lyrics_matrix = compute_tfidf(songs['text'])

    image_url = st.text_input("Paste the URL link of the image:")
    if st.button("Generate Playlist"):
        if image_url:
            try:
                raw_image = Image.open(requests.get(image_url, stream=True).raw).convert('RGB')
            except Exception as e:
                st.error(f"Failed to load image: {e}")
                return

            text = "a photography of"
            inputs = processor(raw_image, text, return_tensors="pt")
            out = model.generate(**inputs)
            conditional_caption = processor.decode(out[0], skip_special_tokens=True)

            inputs = processor(raw_image, return_tensors="pt")
            out = model.generate(**inputs)
            unconditional_caption = processor.decode(out[0], skip_special_tokens=True)

            text_caption = conditional_caption  # Simplified logic
            st.write("Image Caption:", text_caption)

            keywords = extractKeywords(text_caption)
            st.write("Extracted Keywords:", ', '.join(keywords))

            recommendations = songRecommender(keywords, tfidf, lyrics_matrix, songs)
            top_songs = printTopFive(recommendations, songs)

            st.subheader("Top 5 Recommended Songs:")
            for idx, (song_name, artist, score) in enumerate(top_songs):
                st.write(f"{idx+1}. {song_name} by {artist} (Score: {score:.2f})")

if __name__ == "__main__":
    main()

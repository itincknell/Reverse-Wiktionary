# Reverse Wiktionary -- Design Document

## Overview

Reverse Wiktionary is a semantic search system that maps natural
language descriptions to words using Wiktionary as a corpus. The system
is designed as an end-to-end pipeline spanning data ingestion,
preprocessing, embedding, vector indexing, and query serving.

------------------------------------------------------------------------

## High-Level Architecture

    Wiktionary Dump
        ↓
    Azure Blob Storage (raw)
        ↓
    Preprocessing Pipeline (VM)
        ↓
    Normalized JSONL + Embeddings
        ↓
    Qdrant Vector Index
        ↓
    FastAPI Service
        ↓
    Web UI / Client

------------------------------------------------------------------------

## Stage 1: Data Ingestion

### Inputs

-   Wiktionary JSONL or XML dump

### Outputs

-   Raw data stored in Azure Blob Storage

### Design Notes

-   Blob Storage is the source of truth after initial upload

-   Local downloads are ephemeral and not reused

-   Data is versioned via folder structure:

        raw/wiktionary/<timestamp>/

------------------------------------------------------------------------

## Stage 2: Preprocessing Pipeline

### Goals

-   Normalize raw records into embedding-ready rows
-   Ensure deterministic, reproducible output
-   Support partial reprocessing

### Input Contract

Each input line is a JSON object:

    {
      "word": str,
      "pos": str,
      "senses": list
    }

### Output Contract

Each output line is a normalized row:

    {
      "word": str,
      "pos": str,
      "sense_index": int,
      "glosses": list[str],
      "embedding_text": str
    }

### Pipeline Steps

1.  Parse JSONL stream
2.  Validate record structure
3.  Extract senses
4.  Clean and deduplicate glosses
5.  Construct embedding text
6.  Write normalized JSONL shards

### Design Decisions

-   One row per sense
-   Glosses preserved as ordered list
-   Deduplication scoped within sense
-   Streaming processing for scalability

### Failure Handling

-   Skip malformed JSON lines
-   Skip records missing required fields
-   Track metrics (skipped rows, processed rows)

------------------------------------------------------------------------

## Stage 3: Embedding

### Inputs

-   Normalized JSONL shards

### Outputs

-   Vector embeddings
-   Optional intermediate embedding files

### Process

-   Batch rows
-   Encode using Sentence Transformers
-   Upsert into Qdrant

### Design Notes

-   Single-node batch processing (initial implementation)
-   GPU optional but not required
-   Deterministic batching

------------------------------------------------------------------------

## Stage 4: Vector Storage (Qdrant)

### Structure

-   One collection for all entries
-   Payload includes:
    -   word
    -   pos
    -   glosses
    -   sense_index

### Design Decisions

-   Use cosine similarity
-   Enable filtering by POS
-   Persist storage on disk

### Persistence

-   Qdrant snapshot exported to Blob Storage
-   Snapshots treated as deployable artifacts

------------------------------------------------------------------------

## Stage 5: Deployment

### Components

-   Azure VM for serving
-   Dockerized Qdrant instance
-   FastAPI service

### Deployment Flow

1.  Provision VM
2.  Pull Qdrant snapshot from Blob
3.  Start Qdrant container
4.  Start API service

### Design Notes

-   Qdrant state stored on disk volume
-   API stateless except for request handling
-   Blob used for artifact distribution

------------------------------------------------------------------------

## Stage 6: API Layer

### Framework

-   FastAPI

### Endpoints

#### POST /search

Input:

    {
      "query": str,
      "top_k": int,
      "pos": optional[str]
    }

Output:

    {
      "results": list
    }

#### GET /health

-   Returns service status

### Behavior

-   Encode query into embedding
-   Query Qdrant
-   Apply metadata filters
-   Return ranked results

------------------------------------------------------------------------

## Stage 7: Web UI

### Features

-   Search input
-   Results panel
-   POS filter dropdown
-   Selected filters display

### Implementation

-   Server-rendered HTML (Jinja2)
-   HTMX for dynamic updates

------------------------------------------------------------------------

## Design Principles

-   Deterministic pipelines
-   Streaming over batch loading
-   Clear stage boundaries
-   Reproducible artifacts
-   Minimal operational complexity

------------------------------------------------------------------------

## Future Extensions

-   Distributed preprocessing
-   Multi-language support
-   Query expansion
-   Re-ranking models
-   Caching layer

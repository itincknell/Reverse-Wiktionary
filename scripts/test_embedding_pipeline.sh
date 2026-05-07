#!/usr/bin/env bash

./scripts/start_qdrant.sh

./scripts/test_generate_embeddings.sh

./scripts/stop_qdrant.sh
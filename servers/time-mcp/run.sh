#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
exec "$project_dir/.venv/node/bin/node" "$project_dir/dist/index.js"

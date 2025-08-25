#!/bin/bash

# Load environment variables from .env file
if [ -f "/Users/olegshevchenko/Sourses/MCP/.env" ]; then
    export $(grep -v '^#' /Users/olegshevchenko/Sourses/MCP/.env | xargs)
fi

# Start VS Code Insiders with environment variables and experimental flags
"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" \
    --enable-proposed-api \
    --enable-experimental-features \
    "$@"
#!/bin/bash

INPUT_FILE="$1"
OUTPUT_FILE="$2"
INPUT_FILE=$(realpath "$INPUT_FILE")
OUTPUT_FILE=$(realpath "$OUTPUT_FILE")

# Check for ImageMagick
if [ "$(which "magick")" != "" ]; then
    CONVERT_FUNCTION=magick
elif [ "$(which "convert")" != "" ]; then
    CONVERT_FUNCTION=convert
else
    exit 1
fi

# Extract the embedded thumbnail using exiv2
exiv2 -ep1 -l . "$INPUT_FILE"

# Derive the base name of the input file (without extension)
BASENAME=$(basename "$INPUT_FILE" | sed 's/\(.*\)\..*/\1/')

# Use shell globbing instead of find (enable nullglob temporarily)
shopt -s nullglob
PREVIEW_FILES=( "${BASENAME}-preview1."* )
shopt -u nullglob

# Check if we found any preview files
if [ ${#PREVIEW_FILES[@]} -eq 0 ]; then
    exit 1
fi
THUMBNAIL_FILE="${PREVIEW_FILES[0]}"

# If a preview file exists, convert it to the output location
if [ -f "$THUMBNAIL_FILE" ]; then
    # echo "Thumbnail found, converting to $OUTPUT_FILE"
    # Extract Exif orientation - parse the exact format from exiftool
    ORIENTATION=$(exiftool -Orientation -n "$INPUT_FILE" | sed 's/Orientation[ ]*: //')
    # echo "Detected orientation: $ORIENTATION"
    # Convert JPG to PNG and apply rotation based on orientation
    if [ -n "$ORIENTATION" ] && [ "$ORIENTATION" -ne 1 ]; then
        # echo "Rotating image (orientation: $ORIENTATION)"
        case "$ORIENTATION" in
            2) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -flop "$OUTPUT_FILE" ;;
            3) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -rotate 180 "$OUTPUT_FILE" ;;
            4) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -flip "$OUTPUT_FILE" ;;
            5) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -transpose "$OUTPUT_FILE" ;;
            6) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -rotate 90 "$OUTPUT_FILE" ;;
            7) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -transverse "$OUTPUT_FILE" ;;
            8) $CONVERT_FUNCTION "$THUMBNAIL_FILE" -rotate 270 "$OUTPUT_FILE" ;;
            *) $CONVERT_FUNCTION "$THUMBNAIL_FILE" "$OUTPUT_FILE" ;;
        esac
    else
        # No orientation or normal orientation
        convert "$THUMBNAIL_FILE" "$OUTPUT_FILE"
    fi
    # Clean up the temporary JPG file
    rm "$THUMBNAIL_FILE"
    exit 0
else
    # echo "No embedded thumbnail found for $INPUT_FILE" >&2
    exit 1
fi

#!/bin/sh
set -eu

out="$1"
work="$2"

rm -rf "$work"
mkdir -p "$work/vendor"

pack()
{
    spec="$1"
    dest="$2"
    mkdir -p "$work/vendor/$dest"
    tgz=$(cd "$work" && npm pack "$spec" --silent)
    tar -xzf "$work/$tgz" -C "$work/vendor/$dest" --strip-components=1
    rm -f "$work/$tgz"
}

pack '@emoji-mart/data@1.2.1' '@emoji-mart/data'
pack '@fortawesome/fontawesome-free@6.4.2' '@fortawesome/fontawesome-free'
pack '@mediapipe/selfie_segmentation@0.1.1675465747' '@mediapipe/selfie_segmentation'
pack '@popperjs/core@2.11.8' '@popperjs/core'
pack '@simonwep/pickr@1.9.1' '@simonwep/pickr'
pack 'animate.css@4.1.1' 'animate.css'
pack 'animejs@3.0.1' 'animejs'
pack 'axios@1.20.0' 'axios'
pack 'bootstrap@5.0.2' 'bootstrap'
pack 'crypto-js@4.2.0' 'crypto-js'
pack 'emoji-mart@5.6.0' 'emoji-mart'
pack 'fabric@5.3.0-browser' 'fabric'
pack 'flatpickr@4.6.13' 'flatpickr'
pack 'gifler@0.1.0' 'gifler'
pack 'html2canvas@1.4.1' 'html2canvas'
pack 'jspdf@3.0.4' 'jspdf'
pack '@highlightjs/cdn-assets@11.10.0' 'highlight.js'
pack 'marked@18.0.14' 'marked'
pack 'pdfjs-dist@3.11.174' 'pdfjs-dist'
pack 'qrcodejs@1.0.0' 'qrcodejs'
pack 'qrious@4.0.2' 'qrious'
pack 'quill@2.0.3' 'quill'
pack 'scrollreveal@4.0.0' 'scrollreveal'
pack 'sweetalert2@11.4.8' 'sweetalert2'
pack 'tippy.js@6.3.7' 'tippy.js'
pack 'ua-parser-js@1.0.41' 'ua-parser-js'
pack 'w3-css@4.1.0' 'w3-css'
pack 'xss@1.0.15' 'xss'

test -s "$work/vendor/html2canvas/dist/html2canvas.min.js"
test -s "$work/vendor/jspdf/dist/jspdf.umd.min.js"
test -s "$work/vendor/highlight.js/highlight.min.js"
test -s "$work/vendor/highlight.js/styles/atom-one-dark.min.css"

tar -czf "$out" -C "$work" vendor

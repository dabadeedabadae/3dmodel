# Models (all run locally, nothing is uploaded)

| File | What | Source | Licence | sha256 |
|---|---|---|---|---|
| `mobilenetv2-12.onnx` (14.0 MB) | ImageNet-1k classifier used for category suggestions | ONNX model zoo `validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx` | Apache-2.0 (`onnx-models-LICENSE.txt`) | `c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5` |
| `synset.txt` | the 1000 ImageNet labels | ONNX model zoo | Apache-2.0 | — |
| `u2netp.onnx` (4.6 MB) | U²-Netp salient-object segmentation used for the garment mask | rembg release asset `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx` (export of xuebinqin/U-2-Net) | Apache-2.0 (`U-2-Net-LICENSE.txt`); rembg itself MIT, no rembg code used | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |

Runtime: `onnxruntime-web` 1.31.1 (MIT), wasm backend, 1 thread. No CUDA, no server, no API keys.
Rejected alternatives: `@imgly/background-removal` (AGPL-3.0), BRIA RMBG-1.4/2.0 (non-commercial licence), CLIP via Hugging Face (not reachable from the build environment; could be added later as an optional provider).

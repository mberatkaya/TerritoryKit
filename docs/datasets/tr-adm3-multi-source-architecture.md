# Turkey ADM3 Multi-Source Architecture

Turkey ADM3 resolution is modeled as five provider classes: official, runtime, experimental, osm, and generated.
Production default priority is official -> runtime -> osm -> generated. Experimental records are retained but disabled by default.

Provider availability is not spatial coverage. Spatial coverage is measured only by the real build pipeline after source geometry is loaded, clipped, and aggregated.

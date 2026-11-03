#!/usr/bin/env python3
"""Une los estilos claro y oscuro en uno solo con las mismas capas.

Así cambiar de tema solo toca colores y el mapa no vuelve a cargar nada.
Uso: python3 tools/build-map-theme.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
light = json.loads((ROOT / 'map-style/map-style-light.json').read_text(encoding='utf8'))
dark = json.loads((ROOT / 'map-style/map-style-dark.json').read_text(encoding='utf8'))
dark_by_id = {layer['id']: layer for layer in dark['layers']}

# Capas del estilo claro que en el oscuro se llaman de otra forma.
SAME_ROLE = {
    'park': 'landuse_park',
    'tunnel_motorway_casing': 'highway_motorway_casing',
    'tunnel_motorway_inner': 'highway_motorway_inner',
    'railway_service': 'railway_minor',
    'railway_service_dashline': 'railway_minor_dashline',
    'highway_motorway_bridge_casing': 'highway_motorway_casing',
    'highway_motorway_bridge_inner': 'highway_motorway_inner',
    'boundary_3': 'boundary_state',
    'boundary_2': 'boundary_country_z5-',
    'boundary_disputed': 'boundary_state',
    'waterway_line_label': 'water_name',
    'water_name_point_label': 'water_name',
    'water_name_line_label': 'water_name',
    'highway-name-path': 'highway_name_other',
    'highway-name-minor': 'highway_name_other',
    'highway-name-major': 'highway_name_other',
    'airport': 'place_other',
    'label_other': 'place_other',
    'label_village': 'place_village',
    'label_town': 'place_town',
    'label_state': 'place_state',
    'label_city': 'place_city',
    'label_city_capital': 'place_city_large',
    'label_country_3': 'place_country_other',
    'label_country_2': 'place_country_minor',
    'label_country_1': 'place_country_major',
}
COLOURS = {'fill-color', 'fill-outline-color', 'line-color', 'line-opacity', 'text-color', 'text-halo-color', 'text-halo-blur', 'text-halo-width'}
HIDDEN_IN_DARK = {'highway-shield-non-us': {'icon-opacity': 0, 'text-opacity': 0},
                  'highway-shield-us-interstate': {'icon-opacity': 0, 'text-opacity': 0},
                  'road_shield_us': {'icon-opacity': 0, 'text-opacity': 0}}

style = dict(light)
style['layers'] = []
themes = {'light': {}, 'dark': {}}

def add_theme(layer_id, light_paint, dark_paint):
    keys = set(light_paint) | set(dark_paint)
    for key in sorted(keys):
        a, b = light_paint.get(key), dark_paint.get(key, light_paint.get(key))
        if a != b:
            themes['light'].setdefault(layer_id, {})[key] = a
            themes['dark'].setdefault(layer_id, {})[key] = b

for layer in light['layers']:
    style['layers'].append(layer)
    layer_id = layer['id']
    paint = layer.get('paint', {})
    if layer_id in HIDDEN_IN_DARK:
        add_theme(layer_id, paint, HIDDEN_IN_DARK[layer_id])
    elif layer_id in dark_by_id:
        add_theme(layer_id, paint, dark_by_id[layer_id].get('paint', {}))
    elif layer_id in SAME_ROLE:
        other = dark_by_id[SAME_ROLE[layer_id]].get('paint', {})
        add_theme(layer_id, paint, {k: v for k, v in other.items() if k in COLOURS})
    else:
        raise SystemExit(f'Falta equivalencia para la capa {layer_id}')
    if layer_id == 'landcover_wood':
        extra = json.loads(json.dumps(dark_by_id['landuse_residential']))
        add_theme(extra['id'], {'fill-opacity': 0}, {'fill-opacity': extra['paint']['fill-opacity']})
        extra['paint']['fill-opacity'] = 0
        style['layers'].append(extra)

style['transition'] = {'duration': 120, 'delay': 0}
out = ROOT.parent / 'app/demo/data/map-style.json'
out.write_text(json.dumps({'style': style, 'themes': themes}, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(out, out.stat().st_size, 'capas', len(style['layers']), 'con cambios', len(themes['dark']))

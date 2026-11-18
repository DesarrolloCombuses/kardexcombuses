"""Inserta el cuerpo de un .docx generado dentro de la hoja membrete de Combuses.
Uso: python3 merge.py generado.docx membrete.docx salida.docx"""
import re, sys, zipfile, shutil, os

gen_path, mem_path, out_path = sys.argv[1:4]
g = zipfile.ZipFile(gen_path)
gdoc = g.read('word/document.xml').decode()
grels = g.read('word/_rels/document.xml.rels').decode()

body = re.search(r'<w:body>(.*)</w:body>', gdoc, re.S).group(1)
body = re.sub(r'<w:sectPr.*?</w:sectPr>\s*$', '', body, flags=re.S)

m = zipfile.ZipFile(mem_path)
files = {n: m.read(n) for n in m.namelist() if not n.endswith('/')}
mdoc = files['word/document.xml'].decode()
mrels = files['word/_rels/document.xml.rels'].decode()

# Copiar imágenes del cuerpo y remapear ids
used = set(map(int, re.findall(r'Id="rId(\d+)"', mrels)))
nxt = max(used) + 100
newrels = ''
for rel in re.findall(r'<Relationship [^>]*/>', grels):
    if '/image"' not in rel:
        continue
    rid = re.search(r'Id="([^"]+)"', rel).group(1)
    target = re.search(r'Target="([^"]+)"', rel).group(1)
    if f'r:embed="{rid}"' not in body:
        continue
    ext = os.path.splitext(target)[1]
    nid = f'rId{nxt}'; nxt += 1
    name = f'media/ev_{nid}{ext}'
    files['word/' + name] = g.read('word/' + target)
    newrels += f'<Relationship Id="{nid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{name}"/>'
    body = body.replace(f'r:embed="{rid}"', f'r:embed="X{nid}"')
body = body.replace('r:embed="XrId', 'r:embed="rId')
mrels = mrels.replace('</Relationships>', newrels + '</Relationships>')

# Ajustar márgenes para no pisar el encabezado ni la franja del pie
sect = re.search(r'<w:sectPr.*?</w:sectPr>', mdoc, re.S).group(0)
sect2 = re.sub(r'<w:pgMar [^>]*/>',
               '<w:pgMar w:top="1900" w:right="1440" w:bottom="2200" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>', sect)
mdoc = re.sub(r'<w:body>.*</w:body>', lambda _: '<w:body>' + body + sect2 + '</w:body>', mdoc, flags=re.S)

files['word/document.xml'] = mdoc.encode()
files['word/_rels/document.xml.rels'] = mrels.encode()
ct = files['[Content_Types].xml'].decode()
for ext, mime in (('png', 'image/png'), ('jpeg', 'image/jpeg'), ('jpg', 'image/jpeg')):
    if f'Extension="{ext}"' not in ct:
        ct = re.sub(r'(<Types[^>]*>)', rf'\1<Default Extension="{ext}" ContentType="{mime}"/>', ct, count=1)
files['[Content_Types].xml'] = ct.encode()

with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, data in files.items():
        z.writestr(n, data)

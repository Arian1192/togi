# Licencia de las fuentes

Las tres familias del manual de marca se distribuyen con la app bajo la **SIL Open Font License,
Version 1.1** (texto completo más abajo). La licencia exige que cada copia lleve el aviso de
copyright y este texto: por eso viven junto a los ficheros `.woff2`.

| Familia | Aviso de copyright | Origen |
| --- | --- | --- |
| Shippori Mincho | Copyright 2021 The Shippori Mincho Project Authors (https://github.com/fontdasu/ShipporiMincho) | `@fontsource/shippori-mincho` 5.3.0 |
| Zen Kaku Gothic New | Copyright 2022 The Zen Project Authors (https://github.com/googlefonts/zen-kakugothic) | `@fontsource/zen-kaku-gothic-new` 5.3.1 |
| M PLUS 1 Code | Copyright 2021 The M+ FONTS Project Authors (https://github.com/coz-m/MPLUS_FONTS) | `@fontsource/m-plus-1-code` 5.3.1 |

Comprobado en el `LICENSE` y el `package.json` de cada paquete (`"license": "OFL-1.1"`): los tres
textos son idénticos salvo la primera línea, y **ninguno declara un Reserved Font Name**, así que
los subconjuntos pueden conservar el nombre de la familia.

## Qué son los ficheros

Los `.woff2` son trozos (subconjuntos de caracteres) de las fuentes de Google Fonts que publica
`@fontsource`, copiados tal cual, sin modificar sus glifos. Se nombran `<familia>-<trozo>-<peso>`:
`latin` es el latín (con tildes, ñ, ¿ y ¡) y los números son el trozo de la división de Google
(el mismo número de `unicode-range` de `@fontsource`):

- `119`, `115` y `116`: kana (`115` es む y `116` es モ).
- `107`, `111`, `113` y `117`: los kanji 研, 二, 三 y 一 (wordmark y numeración de secciones).

`src/fonts.css` declara para cada trozo solo el `unicode-range` que usa la marca; lo demás cae a las
familias de reserva de los tokens (Hiragino, `system-ui`, `ui-monospace`). M PLUS 1 Code solo lleva
latín: no trae los glifos de estado ◆ ● ◐ ◑ ni ✕, que salen de la fuente del sistema.

Para añadir caracteres: busca el trozo con `fontkit` o similar, mirando el mapa de caracteres del
`.woff2` y no el `unicode-range` de `@fontsource`, que es un rango amplio y no dice qué glifos trae
el fichero. Instala el paquete con su versión exacta en una carpeta temporal, copia el `.woff2` a
esta carpeta y declara su `unicode-range` en `fonts.css`. `src/fonts-cmap.test.ts` comprueba que
cada carácter declarado existe en su fichero.

## Texto de la licencia

```text
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

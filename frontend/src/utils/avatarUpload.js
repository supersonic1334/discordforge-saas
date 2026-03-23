const MAX_INPUT_FILE_SIZE = 8 * 1024 * 1024
const MAX_OUTPUT_LENGTH = 1_200_000
const MAX_DIMENSION = 512
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image invalide.'))
    image.src = dataUrl
  })
}

function drawAvatar(image, mimeType, quality) {
  const ratio = Math.min(MAX_DIMENSION / image.width, MAX_DIMENSION / image.height, 1)
  const width = Math.max(1, Math.round(image.width * ratio))
  const height = Math.max(1, Math.round(image.height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Le navigateur ne peut pas preparer cette image.')
  }

  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(mimeType, quality)
}

export async function prepareAvatarDataUrl(file) {
  if (!file) throw new Error('Aucun fichier selectionne.')
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Formats acceptes: JPG, PNG, WEBP ou GIF.')
  }
  if (file.size > MAX_INPUT_FILE_SIZE) {
    throw new Error('Image trop lourde. Maximum: 8 Mo.')
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(sourceDataUrl)

  let output = drawAvatar(image, 'image/webp', 0.86)
  if (output.length > MAX_OUTPUT_LENGTH) {
    output = drawAvatar(image, 'image/jpeg', 0.82)
  }

  if (output.length > MAX_OUTPUT_LENGTH) {
    throw new Error('Image trop lourde apres compression. Choisis une image plus legere.')
  }

  return output
}

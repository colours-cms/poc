import { GraphQLScalarType, Kind } from 'graphql'
import { UserInputError } from 'apollo-server-core'

const validate = string => {
  if (/[^A-Za-z0-9_-]/.test(string)) {
    throw new UserInputError('String contains forbidden characters.', {
      messageCode: 'forbiddenCharacters',
      characters: string.match(/[^A-Za-z0-9_-]/g),
    })
  }

  return string
}

const UrlString = new GraphQLScalarType({
  name: 'UrlString',
  description: 'Url-safe string. Can only contain [A-Za-z0-9_-].',
  serialize: value => value,
  parseValue: validate,
  parseLiteral: ast => {
    if (ast.kind !== Kind.STRING) {
      throw new UserInputError('Value is not a string.', {
        messageCode: 'requiresString',
      })
    }

    return validate(ast.value)
  },
})

export default UrlString

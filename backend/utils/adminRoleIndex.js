const ADMIN_ROLE_INDEX_NAME = "unique_admin_role";
const ADMIN_ROLE_INDEX_KEY = { role: 1 };
const ADMIN_ROLE_INDEX_OPTIONS = {
  name: ADMIN_ROLE_INDEX_NAME,
  unique: true,
  partialFilterExpression: { role: "admin" }
};

const isSingleAdminIndex = (index) =>
  index?.name === ADMIN_ROLE_INDEX_NAME &&
  index?.unique === true &&
  index?.key?.role === 1 &&
  Object.keys(index.key).length === 1 &&
  index?.partialFilterExpression?.role === "admin" &&
  Object.keys(index.partialFilterExpression).length === 1;

const isLegacyRoleIndex = (index) =>
  index?.name === "role_1" &&
  index?.unique !== true &&
  index?.sparse !== true &&
  index?.hidden !== true &&
  index?.expireAfterSeconds === undefined &&
  index?.collation === undefined &&
  index?.partialFilterExpression === undefined &&
  index?.key?.role === 1 &&
  Object.keys(index.key).length === 1;

const getRoleIndexes = (indexes) =>
  indexes.filter((index) => index?.key && Object.hasOwn(index.key, "role"));

module.exports = {
  ADMIN_ROLE_INDEX_NAME,
  ADMIN_ROLE_INDEX_KEY,
  ADMIN_ROLE_INDEX_OPTIONS,
  isSingleAdminIndex,
  isLegacyRoleIndex,
  getRoleIndexes
};

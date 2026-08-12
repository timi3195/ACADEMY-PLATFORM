const marketplaceService = require("../services/marketplaceService");

exports.getLibrary = async (req, res) => {
  try {
    const library = await marketplaceService.getLibrary(req.user.id, req.query, req);
    res.json({ success: true, library });
  } catch (error) {
    console.error("Library fetch error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLibraryItem = async (req, res) => {
  try {
    const item = await marketplaceService.getLibraryItem(req.user.id, req.params.id, req);
    if (!item) {
      return res.status(404).json({ success: false, message: "Library item not found" });
    }
    res.json({ success: true, item });
  } catch (error) {
    console.error("Library item fetch error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
